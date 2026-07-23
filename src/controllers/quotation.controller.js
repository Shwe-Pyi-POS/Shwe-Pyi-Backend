import mongoose from "mongoose";
import Quotation from "../models/quotation.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import { logActivity } from "../services/activityLog.service.js";

// ============================================================
// Create Quotation — same body as createOrder, NO side effects
// ============================================================
export const createQuotation = asyncErrorHandler(async (req, res, next) => {
  const {
    saleType = "storefront",
    storefrontId,
    customerName,
    customerPhone,
    note,
    ordersProducts,
    subTotal,
    tax = 0,
    discount = 0,
    finalAmount,
  } = req.body;
  const createdBy = req.user._id;

  // Validate saleType
  const validSaleTypes = ["storefront", "direct-sale"];
  if (!validSaleTypes.includes(saleType)) {
    return next(new CustomError(400, `Invalid sale type. Allowed: ${validSaleTypes.join(", ")}`));
  }

  // Validate products
  if (!ordersProducts || !Array.isArray(ordersProducts) || ordersProducts.length === 0) {
    return next(new CustomError(400, "Quotation must have at least one product"));
  }

  for (let i = 0; i < ordersProducts.length; i++) {
    const p = ordersProducts[i];
    if (!p.inventoryId) {
      return next(new CustomError(400, `Product at index ${i}: Inventory ID is required`));
    }
    if (!mongoose.Types.ObjectId.isValid(p.inventoryId)) {
      return next(new CustomError(400, `Product at index ${i}: Invalid inventory ID format`));
    }
    if (!p.quantity || p.quantity < 1) {
      return next(new CustomError(400, `Product at index ${i}: Quantity must be at least 1`));
    }
  }

  if (tax < 0 || discount < 0) {
    return next(new CustomError(400, "Tax and discount cannot be negative"));
  }

  // Fetch all inventory items for UOM conversion & product details
  const inventoryIds = ordersProducts.map((p) => new mongoose.Types.ObjectId(p.inventoryId));
  const inventoryItems = await Inventory.find({ _id: { $in: inventoryIds } });

  if (inventoryItems.length !== inventoryIds.length) {
    const foundIds = inventoryItems.map((i) => i._id.toString());
    const missingIds = inventoryIds.filter((id) => !foundIds.includes(id.toString()));
    return next(new CustomError(404, `Inventory items not found: ${missingIds.join(", ")}`));
  }

  const inventoryMap = new Map();
  inventoryItems.forEach((item) => inventoryMap.set(item._id.toString(), item));

  // Process products with UOM conversion (same logic as createOrder)
  const validatedProducts = [];
  let calculatedSubTotal = 0;

  for (const product of ordersProducts) {
    const invId = new mongoose.Types.ObjectId(product.inventoryId);
    const invItem = inventoryMap.get(invId.toString());

    if (!invItem) {
      return next(new CustomError(404, `Inventory item not found: ${product.inventoryId}`));
    }

    if (invItem.sellingPrice == null || invItem.sellingPrice < 0) {
      return next(new CustomError(400, `Product '${invItem.productCode}' has an invalid selling price`));
    }

    let factor = 1;
    let unit = product.unit || null;
    let baseQuantity = product.quantity;

    if (unit && invItem.uomConversions?.length > 0) {
      const conversion = invItem.uomConversions.find(
        (c) => c.unit?.toLowerCase() === String(unit).toLowerCase(),
      );
      if (conversion) {
        factor = conversion.factor;
        baseQuantity = product.quantity / factor;
      }
    }

    const unitPrice = invItem.sellingPrice / factor;
    const productSubTotal = product.quantity * unitPrice;
    calculatedSubTotal += productSubTotal;

    validatedProducts.push({
      inventoryId: invId,
      productName: invItem.productName,
      productCode: invItem.productCode,
      unit,
      factor,
      quantity: product.quantity,
      baseQuantity,
      unitPrice,
    });
  }

  const finalSubTotal = subTotal != null ? subTotal : calculatedSubTotal;
  const finalAmt = finalAmount != null ? finalAmount : finalSubTotal + tax - discount;

  if (finalAmt < 0) {
    return next(new CustomError(400, "Final amount cannot be negative"));
  }

  // Generate quotation number
  const quotationNumber = await Quotation.generateQuotationNumber();

  const quotation = await Quotation.create({
    quotationNumber,
    saleType,
    storefrontId: storefrontId ? new mongoose.Types.ObjectId(storefrontId) : null,
    customerName: customerName || null,
    customerPhone: customerPhone || null,
    note: note || null,
    products: validatedProducts,
    subTotal: finalSubTotal,
    tax,
    discount,
    finalAmount: finalAmt,
    status: "draft",
    createdBy,
  });

  logActivity({
    admin: createdBy,
    action: "create",
    feature: "quotation",
    description: `Created quotation ${quotation.quotationNumber} - ${quotation.finalAmount} MMK`,
    targetId: quotation._id,
    targetModel: "Quotation",
    metadata: { saleType: quotation.saleType, finalAmount: quotation.finalAmount },
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: "Quotation created successfully",
    data: quotation,
  });
});

// ============================================================
// Get All Quotations
// ============================================================
export const getAllQuotations = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    status,
    saleType,
    customerName,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const filter = { isDeleted: false };

  if (status) {
    const validStatuses = ["draft", "converted", "cancelled"];
    if (!validStatuses.includes(status)) {
      return next(new CustomError(400, `Invalid status. Allowed: ${validStatuses.join(", ")}`));
    }
    filter.status = status;
  }

  if (saleType) {
    const validTypes = ["storefront", "direct-sale"];
    if (!validTypes.includes(saleType)) {
      return next(new CustomError(400, `Invalid sale type. Allowed: ${validTypes.join(", ")}`));
    }
    filter.saleType = saleType;
  }

  if (customerName) {
    filter.customerName = { $regex: customerName, $options: "i" };
  }

  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const [quotations, totalCount] = await Promise.all([
    Quotation.find(filter)
      .populate("storefrontId", "locationName locationCode")
      .populate("createdBy", "name role")
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Quotation.countDocuments(filter),
  ]);

  // Ensure embedded product fields have defaults for old documents
  const productDefaults = { unit: null, factor: 1, baseQuantity: null };
  quotations.forEach((q) => {
    if (q.products) {
      q.products.forEach((p) => {
        Object.keys(productDefaults).forEach((key) => {
          if (p[key] === undefined) p[key] = productDefaults[key];
        });
      });
    }
  });

  // Compute totals for summary
  const summary = quotations.reduce(
    (acc, q) => {
      acc.totalQuotations += 1;
      acc.totalAmount += q.finalAmount || 0;
      acc.totalProducts += q.products?.length || 0;
      return acc;
    },
    { totalQuotations: 0, totalAmount: 0, totalProducts: 0 },
  );

  res.status(200).json({
    success: true,
    message: "Quotations fetched successfully",
    data: {
      summary,
      quotations,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
        totalItems: totalCount,
        itemsPerPage: limitNum,
      },
    },
  });
});

// ============================================================
// Get Quotation By ID
// ============================================================
export const getQuotationById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid quotation ID format"));
  }

  const quotation = await Quotation.findOne({ _id: id, isDeleted: false })
    .populate("storefrontId", "locationName locationCode")
    .populate("products.inventoryId", "productName productCode SKU sellingPrice unitOfMeasure")
    .populate("createdBy", "name role");

  if (!quotation) {
    return next(new CustomError(404, "Quotation not found"));
  }

  // Ensure embedded product fields have defaults for old documents
  const productDefaults = { unit: null, factor: 1, baseQuantity: null };
  if (quotation.products) {
    quotation.products.forEach((p) => {
      Object.keys(productDefaults).forEach((key) => {
        if (p[key] === undefined) p[key] = productDefaults[key];
      });
    });
  }

  res.status(200).json({
    success: true,
    message: "Quotation fetched successfully",
    data: quotation,
  });
});

// ============================================================
// Update Quotation
// ============================================================
export const updateQuotation = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid quotation ID format"));
  }

  const quotation = await Quotation.findOne({ _id: id, isDeleted: false });
  if (!quotation) {
    return next(new CustomError(404, "Quotation not found"));
  }
  if (quotation.status !== "draft") {
    return next(new CustomError(400, "Only draft quotations can be updated"));
  }

  const allowedFields = [
    "customerName", "customerPhone", "note",
    "products", "subTotal", "tax", "discount", "finalAmount",
    "saleType", "storefrontId",
  ];

  // If products are being updated, re-process UOM conversion
  if (req.body.products) {
    const ordersProducts = req.body.products;
    if (!Array.isArray(ordersProducts) || ordersProducts.length === 0) {
      return next(new CustomError(400, "Products must be a non-empty array"));
    }

    const inventoryIds = ordersProducts.map((p) => new mongoose.Types.ObjectId(p.inventoryId));
    const inventoryItems = await Inventory.find({ _id: { $in: inventoryIds } });

    if (inventoryItems.length !== inventoryIds.length) {
      return next(new CustomError(404, "One or more inventory items not found"));
    }

    const inventoryMap = new Map();
    inventoryItems.forEach((item) => inventoryMap.set(item._id.toString(), item));

    const validatedProducts = [];
    let calculatedSubTotal = 0;

    for (const product of ordersProducts) {
      const invId = new mongoose.Types.ObjectId(product.inventoryId);
      const invItem = inventoryMap.get(invId.toString());

      if (!invItem || invItem.sellingPrice == null) {
        return next(new CustomError(400, `Invalid product or missing selling price`));
      }

      let factor = 1;
      let unit = product.unit || null;
      let baseQuantity = product.quantity;

      if (unit && invItem.uomConversions?.length > 0) {
        const conversion = invItem.uomConversions.find(
          (c) => c.unit?.toLowerCase() === String(unit).toLowerCase(),
        );
        if (conversion) {
          factor = conversion.factor;
          baseQuantity = product.quantity / factor;
        }
      }

      const unitPrice = invItem.sellingPrice / factor;
      validatedProducts.push({
        inventoryId: invId,
        productName: invItem.productName,
        productCode: invItem.productCode,
        unit,
        factor,
        quantity: product.quantity,
        baseQuantity,
        unitPrice,
      });
      calculatedSubTotal += product.quantity * unitPrice;
    }

    quotation.products = validatedProducts;

    if (req.body.subTotal == null) {
      quotation.subTotal = calculatedSubTotal;
    }
  }

  // Apply allowed scalar fields
  for (const field of allowedFields) {
    if (field !== "products" && req.body[field] !== undefined) {
      if (field === "storefrontId") {
        quotation.storefrontId = req.body.storefrontId
          ? new mongoose.Types.ObjectId(req.body.storefrontId)
          : null;
      } else {
        quotation[field] = req.body[field];
      }
    }
  }

  // Recalculate finalAmount if not explicitly provided
  if (req.body.finalAmount !== undefined) {
    quotation.finalAmount = req.body.finalAmount;
  } else if (req.body.subTotal !== undefined || req.body.tax !== undefined || req.body.discount !== undefined) {
    quotation.finalAmount = quotation.subTotal + quotation.tax - quotation.discount;
  }

  await quotation.save();

  logActivity({
    admin: req.user._id,
    action: "update",
    feature: "quotation",
    description: `Updated quotation ${quotation.quotationNumber}`,
    targetId: quotation._id,
    targetModel: "Quotation",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Quotation updated successfully",
    data: quotation,
  });
});

// ============================================================
// Soft Delete Quotation
// ============================================================
export const softDeleteQuotation = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid quotation ID format"));
  }

  const quotation = await Quotation.findOneAndUpdate(
    { _id: id, isDeleted: false },
    { isDeleted: true, deletedAt: new Date() },
    { new: true },
  );

  if (!quotation) {
    return next(new CustomError(404, "Quotation not found"));
  }

  logActivity({
    admin: req.user._id,
    action: "delete",
    feature: "quotation",
    description: `Deleted quotation ${quotation.quotationNumber}`,
    targetId: quotation._id,
    targetModel: "Quotation",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Quotation deleted successfully",
    data: quotation,
  });
});

// ============================================================
// Mark Quotation as Converted (order created by frontend via POST /order)
// ============================================================
export const markQuotationAsConverted = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { convertedOrderId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid quotation ID format"));
  }

  if (!convertedOrderId || !mongoose.Types.ObjectId.isValid(convertedOrderId)) {
    return next(new CustomError(400, "Valid convertedOrderId is required"));
  }

  const quotation = await Quotation.findOneAndUpdate(
    { _id: id, isDeleted: false, status: "draft" },
    {
      status: "converted",
      convertedOrderId: new mongoose.Types.ObjectId(convertedOrderId),
    },
    { new: true },
  );

  if (!quotation) {
    return next(new CustomError(404, "Quotation not found or already converted"));
  }

  logActivity({
    admin: req.user._id,
    action: "convert",
    feature: "quotation",
    description: `Converted quotation ${quotation.quotationNumber} to order ${quotation.convertedOrderId}`,
    targetId: quotation._id,
    targetModel: "Quotation",
    metadata: { convertedOrderId: quotation.convertedOrderId },
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Quotation marked as converted successfully",
    data: quotation,
  });
});
