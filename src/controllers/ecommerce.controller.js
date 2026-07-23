import mongoose from "mongoose";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import EcommerceOrder from "../models/ecommerceOrder.model.js";
import Customer from "../models/customer.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";

const ecommerceStorefrontId = process.env.ECOMMERCE_STOREFRONT_ID;

export const getProducts = asyncErrorHandler(async (req, res, next) => {
  const { page, limit, category, search } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const matchStage = { storefrontId: storefrontObjId };

  const buildPipeline = (forCount = false) => {
    const pipe = [
      { $match: matchStage },
      {
        $lookup: {
          from: "inventories",
          localField: "inventoryId",
          foreignField: "_id",
          as: "inventory",
        },
      },
      { $unwind: "$inventory" },
      { $match: { "inventory.status": "active" } },
    ];

    if (category) {
      pipe.push({ $match: { "inventory.category": category } });
    }

    if (search) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pipe.push({
        $match: {
          $or: [
            { "inventory.productName": { $regex: escaped, $options: "i" } },
            { "inventory.productCode": { $regex: escaped, $options: "i" } },
          ],
        },
      });
    }

    if (forCount) {
      pipe.push({ $count: "total" });
    } else {
      pipe.push({ $skip: skip }, { $limit: limitNum });
      pipe.push({
        $project: {
          _id: 1,
          quantity: 1,
          product: {
            _id: "$inventory._id",
            productName: "$inventory.productName",
            productCode: "$inventory.productCode",
            SKU: "$inventory.SKU",
            category: "$inventory.category",
            subCategory: "$inventory.subCategory",
            brand: "$inventory.brand",
            unitOfMeasure: "$inventory.unitOfMeasure",
            sellingPrice: "$inventory.sellingPrice",
            uomConversions: "$inventory.uomConversions",
            wholesalePrices: "$inventory.wholesalePrices",
            images: "$inventory.images",
          },
        },
      });
    }

    return pipe;
  };

  const [products, countResult] = await Promise.all([
    StorefrontInventory.aggregate(buildPipeline(false)),
    StorefrontInventory.aggregate(buildPipeline(true)),
  ]);

  const totalCount = countResult[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: products,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
      totalItems: totalCount,
      itemsPerPage: limitNum,
    },
  });
});

export const createOrder = asyncErrorHandler(async (req, res, next) => {
  const {
    products,
    shippingAddressId,
    paymentMethod,
    note,
  } = req.body;
  const customerId = req.customer._id;

  let shippingAddress = {};
  if (shippingAddressId !== undefined && shippingAddressId !== null) {
    const addr = req.customer.addresses[shippingAddressId];
    if (!addr) {
      return next(new CustomError(400, "Invalid shippingAddressId"));
    }
    shippingAddress = addr;
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    return next(new CustomError(400, "Order must have at least one product"));
  }

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  // Validate storefront exists
  const storefront = await LocationProfile.findOne({
    _id: storefrontId,
    type: "storefront",
    isDeleted: false,
  });
  if (!storefront) {
    return next(new CustomError(404, "Ecommerce storefront not found"));
  }

  // Fetch all inventory items and stock records
  const inventoryIds = products.map((p) => p.inventoryId);
  const inventories = await Inventory.find({
    _id: { $in: inventoryIds },
    status: "active",
  });
  const inventoryMap = {};
  for (const inv of inventories) {
    inventoryMap[inv._id.toString()] = inv;
  }

  const stockRecords = await StorefrontInventory.find({
    inventoryId: { $in: inventoryIds },
    storefrontId,
  });
  const stockMap = {};
  for (const sr of stockRecords) {
    stockMap[sr.inventoryId.toString()] = sr;
  }

  // Validate each product
  let totalAmount = 0;
  const validatedProducts = [];
  const stockUpdates = [];

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const invId = item.inventoryId;

    if (!mongoose.Types.ObjectId.isValid(invId)) {
      return next(new CustomError(400, `Product at index ${i}: Invalid inventory ID`));
    }

    const inventory = inventoryMap[invId];
    if (!inventory) {
      return next(new CustomError(404, `Product at index ${i}: Inventory not found`));
    }

    const stockRecord = stockMap[invId];
    if (!stockRecord) {
      return next(new CustomError(404, `Product at index ${i}: Not available in ecommerce store`));
    }

    const requestedQty = item.quantity;
    if (!requestedQty || requestedQty < 1) {
      return next(new CustomError(400, `Product at index ${i}: Quantity must be at least 1`));
    }

    if (stockRecord.quantity < requestedQty) {
      return next(new CustomError(400, `Product at index ${i}: Insufficient stock (available: ${stockRecord.quantity}, requested: ${requestedQty})`));
    }

    let unitPrice = inventory.sellingPrice;
    if (item.unitPrice) {
      unitPrice = item.unitPrice;
    } else if (inventory.wholesalePrices?.length > 0) {
      const sorted = [...inventory.wholesalePrices].sort((a, b) => b.quantity - a.quantity);
      const tier = sorted.find((wp) => requestedQty >= wp.quantity);
      if (tier) unitPrice = tier.price;
    }
    const subtotal = requestedQty * unitPrice;
    totalAmount += subtotal;

    validatedProducts.push({
      inventoryId: new mongoose.Types.ObjectId(invId),
      productName: inventory.productName,
      productCode: inventory.productCode,
      unit: item.unit || inventory.unitOfMeasure || null,
      quantity: requestedQty,
      unitPrice,
      subtotal,
    });

    stockUpdates.push({
      stockRecord,
      deductQty: requestedQty,
    });
  }

  // Deduct stock
  for (const update of stockUpdates) {
    update.stockRecord.quantity -= update.deductQty;
    update.stockRecord.lastUpdated = new Date();
    await update.stockRecord.save();
  }

  // Create order
  const order = await EcommerceOrder.create({
    customerId,
    products: validatedProducts,
    shippingAddress: shippingAddress || {},
    totalAmount,
    paymentMethod: paymentMethod || "cash_on_delivery",
    note: note || null,
  });

  await order.populate("products.inventoryId", "productName productCode SKU images");

  res.status(201).json({
    success: true,
    message: "Order placed successfully.",
    data: order,
  });
});

export const getMyOrders = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;
  const { page, limit } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    EcommerceOrder.find({ customerId, isDeleted: false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("products.inventoryId", "productName productCode SKU images"),
    EcommerceOrder.countDocuments({ customerId, isDeleted: false }),
  ]);

  res.status(200).json({
    success: true,
    data: orders,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const getMyOrderById = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const order = await EcommerceOrder.findOne({
    _id: id,
    customerId,
    isDeleted: false,
  }).populate("products.inventoryId", "productName productCode SKU images");

  if (!order) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    data: order,
  });
});

export const getAllEcommerceOrders = asyncErrorHandler(async (req, res, next) => {
  const { page, limit, search, status, startDate, endDate } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const filter = { isDeleted: false };
  if (status) filter.status = status;

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  if (search) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const orderMatch = { orderNumber: { $regex: escaped, $options: "i" } };
    const customers = await Customer.find({
      name: { $regex: escaped, $options: "i" },
    }).select("_id");
    const customerIds = customers.map((c) => c._id);
    filter.$or = [orderMatch, { customerId: { $in: customerIds } }];
  }

  const [orders, total] = await Promise.all([
    EcommerceOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("customerId", "name phone")
      .populate("products.inventoryId", "productName productCode SKU images"),
    EcommerceOrder.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: orders,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const getEcommerceOrderById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const order = await EcommerceOrder.findById(id)
    .populate("customerId", "name phone addresses")
    .populate("products.inventoryId", "productName productCode SKU images");

  if (!order || order.isDeleted) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    data: order,
  });
});

export const updateEcommerceOrderStatus = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
  if (!status || !validStatuses.includes(status)) {
    return next(new CustomError(400, `Invalid status. Allowed: ${validStatuses.join(", ")}`));
  }

  const order = await EcommerceOrder.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  if (!order || order.isDeleted) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    message: "Order status updated successfully.",
    data: order,
  });
});

const applyWholesalePrice = (inventory, quantity) => {
  if (!inventory.wholesalePrices?.length) return inventory.sellingPrice;
  const sorted = [...inventory.wholesalePrices].sort((a, b) => b.quantity - a.quantity);
  const tier = sorted.find((wp) => quantity >= wp.quantity);
  return tier ? tier.price : inventory.sellingPrice;
};

const recalculateTotal = (products) => {
  return products.reduce((sum, p) => sum + p.subtotal, 0);
};

export const updateEcommerceOrderProducts = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, products } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (!action || !["add", "remove"].includes(action)) {
    return next(new CustomError(400, 'Action must be "add" or "remove"'));
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    return next(new CustomError(400, "Products array is required and must not be empty"));
  }

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    if (!item.inventoryId) {
      return next(new CustomError(400, `Product at index ${i}: inventoryId is required`));
    }
    if (!mongoose.Types.ObjectId.isValid(item.inventoryId)) {
      return next(new CustomError(400, `Product at index ${i}: Invalid inventoryId`));
    }
    if (!item.quantity || item.quantity < 1) {
      return next(new CustomError(400, `Product at index ${i}: Quantity must be at least 1`));
    }
  }

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const order = await EcommerceOrder.findById(id).session(session);
      if (!order || order.isDeleted) {
        throw new CustomError(404, "Order not found");
      }
      if (order.status !== "pending") {
        throw new CustomError(400, `Cannot modify products when status is "${order.status}". Only pending orders can be modified.`);
      }

      const inventoryIds = products.map((p) => new mongoose.Types.ObjectId(p.inventoryId));
      const inventories = await Inventory.find({ _id: { $in: inventoryIds } }).session(session);
      const inventoryMap = {};
      for (const inv of inventories) {
        inventoryMap[inv._id.toString()] = inv;
      }

      const stockRecords = await StorefrontInventory.find({ inventoryId: { $in: inventoryIds }, storefrontId }).session(session);
      const stockMap = {};
      for (const sr of stockRecords) {
        stockMap[sr.inventoryId.toString()] = sr;
      }

      if (action === "add") {
        for (const item of products) {
          const invId = item.inventoryId;
          const inventory = inventoryMap[invId];
          if (!inventory) {
            throw new CustomError(404, `Inventory not found: ${invId}`);
          }

          const stockRecord = stockMap[invId];
          if (!stockRecord) {
            throw new CustomError(404, `Product not available in ecommerce store: ${invId}`);
          }

          if (stockRecord.quantity < item.quantity) {
            throw new CustomError(400, `Insufficient stock for ${inventory.productName} (available: ${stockRecord.quantity}, requested: ${item.quantity})`);
          }

          const existingIndex = order.products.findIndex(
            (p) => p.inventoryId.toString() === invId
          );

          let unitPrice;
          let newQty;

          if (existingIndex !== -1) {
            const existing = order.products[existingIndex];
            newQty = existing.quantity + item.quantity;
            unitPrice = item.unitPrice || applyWholesalePrice(inventory, newQty);
            existing.quantity = newQty;
            existing.unitPrice = unitPrice;
            existing.subtotal = newQty * unitPrice;
          } else {
            newQty = item.quantity;
            unitPrice = item.unitPrice || applyWholesalePrice(inventory, newQty);
            order.products.push({
              inventoryId: new mongoose.Types.ObjectId(invId),
              productName: inventory.productName,
              productCode: inventory.productCode,
              unit: item.unit || inventory.unitOfMeasure || null,
              quantity: newQty,
              unitPrice,
              subtotal: newQty * unitPrice,
            });
          }

          stockRecord.quantity -= item.quantity;
          stockRecord.lastUpdated = new Date();
          await stockRecord.save({ session });
        }
      }

      if (action === "remove") {
        for (const item of products) {
          const invId = item.inventoryId;
          const existingIndex = order.products.findIndex(
            (p) => p.inventoryId.toString() === invId
          );

          if (existingIndex === -1) {
            throw new CustomError(404, `Product not found in order: ${invId}`);
          }

          const existing = order.products[existingIndex];
          if (item.quantity > existing.quantity) {
            throw new CustomError(400, `Cannot remove ${item.quantity} items. Only ${existing.quantity} exist in order for this product.`);
          }

          const newQty = existing.quantity - item.quantity;
          if (newQty <= 0) {
            order.products.splice(existingIndex, 1);
          } else {
            const inventory = inventoryMap[invId];
            const unitPrice = applyWholesalePrice(inventory, newQty);
            existing.quantity = newQty;
            existing.unitPrice = unitPrice;
            existing.subtotal = newQty * unitPrice;
          }

          const stockRecord = stockMap[invId];
          if (stockRecord) {
            stockRecord.quantity += item.quantity;
            stockRecord.lastUpdated = new Date();
            await stockRecord.save({ session });
          } else {
            await StorefrontInventory.create([{
              inventoryId: new mongoose.Types.ObjectId(invId),
              storefrontId,
              quantity: item.quantity,
              lastUpdated: new Date(),
            }], { session });
          }
        }
      }

      order.totalAmount = recalculateTotal(order.products);
      await order.save({ session });

      await order.populate("products.inventoryId", "productName productCode SKU images");

      logActivity({
        admin: req.user._id,
        action: action === "add" ? "add_items" : "remove_items",
        feature: "ecommerce_order",
        description: `${action === "add" ? "Added" : "Removed"} products from ecommerce order ${order.orderNumber}`,
        targetId: order._id,
        targetModel: "EcommerceOrder",
        ip: req.ip,
      });

      res.status(200).json({
        success: true,
        message: action === "add" ? "Products added successfully" : "Products removed successfully",
        data: order,
      });
    });
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(new CustomError(400, `Validation error: ${errors.join(". ")}`));
    }
    console.error("Update ecommerce order products error:", error);
    return next(new CustomError(500, `Failed to update order products: ${error.message}`));
  } finally {
    await session.endSession();
  }
});
