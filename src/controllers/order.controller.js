import mongoose from "mongoose";
import Order from "../models/orders.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import Inventory from "../models/inventory.model.js";
import CreditPerson from "../models/creditPersona.model.js";
import CreditRecord from "../models/creditRecord.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import { logActivity } from "../services/activityLog.service.js";

const getTotalOutstanding = async (creditPersonId, session = null) => {
  const match = {
    creditPersonId: new mongoose.Types.ObjectId(creditPersonId),
    paymentType: "credit",
    isDeleted: false,
    orderStatus: { $ne: "cancelled" },
  };
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: null,
        totalOutstanding: { $sum: { $subtract: ["$finalAmount", "$paidAmount"] } },
      },
    },
  ];
  const opts = session ? { session } : {};
  const [result] = await Order.aggregate(pipeline).session(opts.session || null);
  return result ? result.totalOutstanding : 0;
};

const checkCreditLimit = async (creditPersonId, additionalAmount, session = null) => {
  const person = await CreditPerson.findById(creditPersonId).session(session || null);
  if (!person) throw new CustomError(404, "Credit person not found");
  if (person.creditLimit == null) return;
  const currentOutstanding = await getTotalOutstanding(creditPersonId, session);
  const newTotal = currentOutstanding + additionalAmount;
  if (newTotal > person.creditLimit) {
    throw new CustomError(400,
      `Credit limit exceeded. Current outstanding: ${currentOutstanding.toLocaleString()} MMK, Limit: ${person.creditLimit.toLocaleString()} MMK, Would need: ${newTotal.toLocaleString()} MMK`
    );
  }
};

// Create new order with ACID properties and stock deduction
export const createOrder = asyncErrorHandler(async (req, res, next) => {
  const {
    saleType = "storefront",
    storefrontId,
    customerName,
    customerPhone,
    customerAddress,
    note,
    ordersProducts,
    subTotal,
    tax = 0,
    discount = 0,
    finalAmount,
    paidAmount,
    paymentType = "paid",
    paymentMethod = "cash",
    creditPersonId,
    orderDate,
    dueDate,
    transportFee = 0,
  } = req.body;
  const soldBy = req.user._id;

  // Validate saleType
  const validSaleTypes = ["storefront", "direct-sale"];
  if (!validSaleTypes.includes(saleType)) {
    return next(
      new CustomError(
        400,
        `Invalid sale type. Allowed values: ${validSaleTypes.join(", ")}`,
      ),
    );
  }

  const isDirectSale = saleType === "direct-sale";

  // Validate storefrontId (required only for storefront sales)
  if (!isDirectSale) {
    if (!storefrontId) {
      return next(new CustomError(400, "Storefront ID is required"));
    }

    if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
      return next(new CustomError(400, "Invalid storefront ID format"));
    }
  }

  if (
    !ordersProducts ||
    !Array.isArray(ordersProducts) ||
    ordersProducts.length === 0
  ) {
    return next(new CustomError(400, "Order must have at least one product"));
  }

  // Validate paymentType
  const validPaymentTypes = ["credit", "paid"];
  if (paymentType && !validPaymentTypes.includes(paymentType)) {
    return next(
      new CustomError(
        400,
        `Invalid payment type. Allowed values: ${validPaymentTypes.join(", ")}`,
      ),
    );
  }

  // Validate creditPersonId format if provided
  if (creditPersonId) {
    if (!mongoose.Types.ObjectId.isValid(creditPersonId)) {
      return next(new CustomError(400, "Invalid credit person ID format"));
    }
  }

  // Validate product structure
  for (let i = 0; i < ordersProducts.length; i++) {
    const product = ordersProducts[i];

    if (!product.inventoryId) {
      return next(
        new CustomError(400, `Product at index ${i}: Inventory ID is required`),
      );
    }

    if (!mongoose.Types.ObjectId.isValid(product.inventoryId)) {
      return next(
        new CustomError(
          400,
          `Product at index ${i}: Invalid inventory ID format`,
        ),
      );
    }

    if (!product.quantity || product.quantity < 1) {
      return next(
        new CustomError(
          400,
          `Product at index ${i}: Quantity must be at least 1`,
        ),
      );
    }
  }

  // Validate numeric fields
  if (tax < 0) {
    return next(new CustomError(400, "Tax cannot be negative"));
  }

  if (discount < 0) {
    return next(new CustomError(400, "Discount cannot be negative"));
  }

  if (!paidAmount && paidAmount !== 0) {
    return next(new CustomError(400, "Paid amount is required"));
  }

  if (paidAmount < 0) {
    return next(new CustomError(400, "Paid amount cannot be negative"));
  }

  // Validate orderDate if provided
  if (orderDate) {
    const parsedDate = new Date(orderDate);
    if (isNaN(parsedDate.getTime())) {
      return next(new CustomError(400, "Invalid order date format"));
    }
    if (parsedDate > new Date()) {
      return next(new CustomError(400, "Order date cannot be in the future"));
    }
  }

  // Validate dueDate if provided
  if (dueDate) {
    const parsed = new Date(dueDate);
    if (isNaN(parsed.getTime())) {
      return next(new CustomError(400, "Invalid due date format"));
    }
  }

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();

  // Retry logic for handling duplicate order numbers
  const maxRetries = 3;
  let retryCount = 0;
  let orderNumber;
  let orderCreated = false;
  let newOrder;
  let lastError = null;

  try {
    while (retryCount < maxRetries && !orderCreated) {
      try {
        // Generate order number (before transaction to allow retry)
        orderNumber = await Order.generateOrderNumber(orderDate);

        // Start transaction
        await session.withTransaction(async () => {
          // 1. Validate storefront exists and is not deleted (only for storefront sales)
          if (!isDirectSale) {
            const storefront = await LocationProfile.findOne({
              _id: storefrontId,
              type: "storefront",
            }).session(session);

            if (!storefront) {
              throw new CustomError(404, "Storefront not found");
            }

            if (storefront.isDeleted) {
              throw new CustomError(
                400,
                "Cannot create order for deleted storefront",
              );
            }
          }

          // 1a. Validate credit person exists if creditPersonId is provided
          let creditPerson = null;
          if (creditPersonId) {
            creditPerson =
              await CreditPerson.findById(creditPersonId).session(session);

            if (!creditPerson) {
              throw new CustomError(404, "Credit person not found");
            }

            // Check if credit person is blacklisted
            if (creditPerson.blacklist) {
              throw new CustomError(
                400,
                `Cannot create order for blacklisted credit person: ${
                  creditPerson.blacklistReason || "No reason provided"
                }`,
              );
            }
          }

          // 2. Validate all inventory items exist and get their selling prices
          const inventoryIds = ordersProducts.map(
            (p) => new mongoose.Types.ObjectId(p.inventoryId),
          );

          const inventoryItems = await Inventory.find({
            _id: { $in: inventoryIds },
          }).session(session);

          if (inventoryItems.length !== inventoryIds.length) {
            const foundIds = inventoryItems.map((item) => item._id.toString());
            const missingIds = inventoryIds.filter(
              (id) => !foundIds.includes(id.toString()),
            );
            throw new CustomError(
              404,
              `Inventory items not found: ${missingIds.join(", ")}`,
            );
          }

          // Map inventory items by ID for easy lookup
          const inventoryMap = new Map();
          inventoryItems.forEach((item) => {
            inventoryMap.set(item._id.toString(), item);
          });

          // 3. Prepare order products with UOM conversion and unitPrice snapshot
          const validatedProducts = [];
          let calculatedSubTotal = 0;

          for (const product of ordersProducts) {
            const inventoryId = new mongoose.Types.ObjectId(
              product.inventoryId,
            );
            const inventoryItem = inventoryMap.get(inventoryId.toString());

            if (!inventoryItem) {
              throw new CustomError(
                404,
                `Inventory item not found: ${product.inventoryId}`,
              );
            }

            if (
              inventoryItem.sellingPrice === undefined ||
              inventoryItem.sellingPrice === null
            ) {
              throw new CustomError(
                400,
                `Product '${inventoryItem.productCode}' (${inventoryItem.productName}) does not have a selling price set`,
              );
            }

            if (inventoryItem.sellingPrice < 0) {
              throw new CustomError(
                400,
                `Product '${inventoryItem.productCode}' (${inventoryItem.productName}) has an invalid selling price: ${inventoryItem.sellingPrice}`,
              );
            }

            // UOM conversion: determine factor and compute unitPrice / baseQuantity
            let factor = 1;
            let unit = product.unit || inventoryItem.unitOfMeasure || null;
            let baseQuantity = product.quantity;

            if (product.unit && inventoryItem.uomConversions?.length > 0) {
              const conversion = inventoryItem.uomConversions.find(
                (c) => c.unit?.toLowerCase() === String(product.unit).toLowerCase(),
              );
              if (conversion) {
                factor = conversion.factor;
                unit = conversion.unit;
                baseQuantity = product.quantity / factor;
              }
            }

            const unitPrice = (isDirectSale && product.unitPrice != null) ? product.unitPrice : inventoryItem.sellingPrice / factor;
            const productSubTotal = product.quantity * unitPrice;
            calculatedSubTotal += productSubTotal;

            validatedProducts.push({
              inventoryId,
              unit,
              factor,
              quantity: product.quantity,
              baseQuantity,
              unitPrice,
            });
          }

          // Use provided subTotal or calculated one
          const finalSubTotal =
            subTotal !== undefined && subTotal !== null
              ? subTotal
              : calculatedSubTotal;

          // Calculate finalAmount if not provided
          const calculatedFinalAmount =
            finalAmount !== undefined && finalAmount !== null
              ? finalAmount
              : finalSubTotal + tax - discount + (transportFee || 0);

          if (calculatedFinalAmount < 0) {
            throw new CustomError(400, "Final amount cannot be negative");
          }

          // Check credit limit (after finalAmount is known)
          if (creditPerson?.creditLimit != null) {
            const additionalAmount = calculatedFinalAmount - paidAmount;
            if (additionalAmount > 0) {
              await checkCreditLimit(creditPersonId, additionalAmount, session);
            }
          }

          // 4. Validate stock availability and deduct stock (only for storefront sales)
          if (!isDirectSale) {
          for (const product of validatedProducts) {
            const stockRecord = await StorefrontInventory.findOne(
              {
                inventoryId: product.inventoryId,
                storefrontId: storefrontId,
              },
              null,
              { session },
            );

            if (!stockRecord) {
              const inventoryItem = inventoryMap.get(
                product.inventoryId.toString(),
              );
              throw new CustomError(
                404,
                `Stock record not found for product '${
                  inventoryItem?.productCode || product.inventoryId
                }' in storefront`,
              );
            }

            // Check stock availability (stock is in base units)
            const availableQuantity = stockRecord.quantity || 0;
            const requestedBase = product.baseQuantity || product.quantity;
            if (availableQuantity < requestedBase) {
              const inventoryItem = inventoryMap.get(
                product.inventoryId.toString(),
              );
              throw new CustomError(
                400,
                `Insufficient stock for product '${
                  inventoryItem?.productCode || product.inventoryId
                }' (${
                  inventoryItem?.productName || "Unknown"
                }). Available: ${availableQuantity}, Requested: ${requestedBase}`,
              );
            }

            // Deduct stock (use baseQuantity for stock deduction)
            stockRecord.quantity -= requestedBase;
            stockRecord.lastUpdated = new Date();
            await stockRecord.save({ session });
          }

          } // End of stock deduction for storefront sales

          // 5. Create order with calculated values
          const orderData = {
            saleType,
            orderNumber,
            storefrontId: storefrontId
              ? new mongoose.Types.ObjectId(storefrontId)
              : null,
            ordersProducts: validatedProducts,
            creditPersonId: creditPersonId
              ? new mongoose.Types.ObjectId(creditPersonId)
              : null,
            subTotal: finalSubTotal,
            tax,
            discount,
            transportFee: transportFee || 0,
            finalAmount: calculatedFinalAmount,
            paidAmount,
            paymentType: paymentType || "paid",
            paymentMethod: paymentMethod || "cash",
            lastPaymentDate: (paymentType === "credit" && paidAmount > 0) ? new Date() : null,
            dueDate: dueDate ? new Date(dueDate) : null,
            orderStatus: "completed",
            customerName: customerName || (creditPerson ? creditPerson.name : null),
            customerPhone: customerPhone || (creditPerson ? creditPerson.phone : null),
            customerAddress: customerAddress || (creditPerson ? creditPerson.address : null),
            note: note || null,
            soldBy,
          };

          if (orderDate) {
            const parsed = new Date(orderDate);
            if (!isNaN(parsed.getTime())) {
              const now = new Date();
              parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
              orderData.createdAt = parsed;
            }
          }

          newOrder = await Order.create([orderData], { session });
          newOrder = newOrder[0];

          // 7. Populate references for response (inside transaction for consistency)
          await newOrder.populate("storefrontId", "locationName locationCode");
          await newOrder.populate(
            "ordersProducts.inventoryId",
            "productName productCode SKU",
          );

          // Mark as created successfully
          orderCreated = true;
        });

        // If we reach here, order was created successfully
        // Send response outside the transaction

        logActivity({
          admin: soldBy,
          action: "create",
          feature: "order",
          description: `Created ${newOrder.orderNumber} (${newOrder.saleType}) for ${newOrder.customerName || "walk-in"} - ${newOrder.finalAmount} MMK`,
          targetId: newOrder._id,
          targetModel: "Order",
          metadata: { saleType: newOrder.saleType, finalAmount: newOrder.finalAmount },
          ip: req.ip,
        });

        res.status(201).json({
          success: true,
          message: "Order created successfully",
          data: newOrder,
        });
        return; // Exit the retry loop
      } catch (error) {
        // Handle transaction errors
        // If it's a CustomError (validation errors, etc.), pass it to error handler
        if (error instanceof CustomError) {
          return next(error);
        }

        // Handle MongoDB duplicate key errors - retry with new order number
        if (error.code === 11000) {
          retryCount++;
          if (retryCount < maxRetries) {
            // Wait a bit before retrying (exponential backoff)
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * retryCount),
            );
            // Continue to next iteration of retry loop
            continue;
          } else {
            // Max retries reached
            return next(
              new CustomError(
                500,
                "Failed to generate unique order number after multiple attempts. Please try again.",
              ),
            );
          }
        }

        // For other errors, store error and break out of retry loop
        lastError = error;
        break;
      }
    }

    // If we exit the loop without creating order, handle the error
    if (!orderCreated) {
      // Handle validation errors
      if (!lastError) {
        lastError = new Error("Order creation failed after retries");
      }
      if (lastError.name === "ValidationError") {
        const errors = Object.values(lastError.errors).map(
          (val) => val.message,
        );
        return next(
          new CustomError(400, `Validation error: ${errors.join(". ")}`),
        );
      }

      // For other errors, log and return with actual error message
      console.error("Order creation error:", lastError);
      const errorMessage =
        lastError?.message || String(lastError) || "Unknown error occurred";
      return next(
        new CustomError(500, `Order creation failed: ${errorMessage}`),
      );
    }
  } catch (error) {
    // Handle any errors that escape the retry loop
    // If it's a CustomError, pass it to error handler
    if (error instanceof CustomError) {
      return next(error);
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(
        new CustomError(400, `Validation error: ${errors.join(". ")}`),
      );
    }

    // Handle MongoDB duplicate key errors (shouldn't reach here with retry logic, but just in case)
    if (error.code === 11000) {
      return next(
        new CustomError(400, "Order number already exists. Please try again."),
      );
    }

    // For other errors, log and return with actual error message
    console.error("Order creation error:", error);
    const errorMessage =
      error?.message || String(error) || "Unknown error occurred";
    return next(new CustomError(500, `Order creation failed: ${errorMessage}`));
  } finally {
    // Always end the session
    await session.endSession();
  }
});

export const getAllOrders = asyncErrorHandler(async (req, res, next) => {
  // Build query filter
  const filter = {
    isDeleted: false,
  };

  // Extract query parameters
  const { saleType, paymentType, paymentMethod, page, limit, search, dueDays, creditPersonId } = req.query;

  // Add saleType filter if provided
  if (saleType !== undefined && saleType !== "") {
    const validSaleTypes = ["storefront", "direct-sale"];
    if (!validSaleTypes.includes(saleType)) {
      return next(
        new CustomError(
          400,
          `Invalid sale type. Allowed values: ${validSaleTypes.join(", ")}`,
        ),
      );
    }
    filter.saleType = saleType;
  }

  // Add creditPersonId filter if provided
  if (creditPersonId !== undefined && creditPersonId !== "") {
    if (!mongoose.Types.ObjectId.isValid(creditPersonId)) {
      return next(new CustomError(400, "Invalid credit person ID format"));
    }
    filter.creditPersonId = new mongoose.Types.ObjectId(creditPersonId);
  }

  // Add paymentType filter if provided
  if (paymentType !== undefined && paymentType !== "") {
    const validPaymentTypes = ["credit", "paid"];
    if (!validPaymentTypes.includes(paymentType)) {
      return next(
        new CustomError(
          400,
          `Invalid payment type. Allowed values: ${validPaymentTypes.join(
            ", ",
          )}`,
        ),
      );
    }
    filter.paymentType = paymentType;
  }

  // Add paymentMethod filter if provided
  if (paymentMethod !== undefined && paymentMethod !== "") {
    // Common payment methods: cash, card, bank_transfer, mobile_payment, etc.
    // Since the model doesn't enforce enum, we'll accept any string but trim it
    filter.paymentMethod = paymentMethod.trim();
  }

  // Add date range filter using dateFilter utility
  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    // If it's a CustomError, pass it to error handler
    if (error instanceof CustomError) {
      return next(error);
    }
    // For other errors, wrap and pass
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // Search by product name or code
  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchedInventory = await Inventory.find({
      $or: [
        { productName: { $regex: escaped, $options: "i" } },
        { productCode: { $regex: escaped, $options: "i" } },
      ],
    }).select("_id");
    const inventoryIds = matchedInventory.map((inv) => inv._id);
    if (inventoryIds.length > 0) {
      filter["ordersProducts.inventoryId"] = { $in: inventoryIds };
    } else {
      // No matching product found — return empty result
      filter._id = null;
    }
  }

  // Auto-filter: dueDate in the next N days (from today to today + dueDays)
  if (dueDays !== undefined && dueDays !== "") {
    const days = parseInt(dueDays);
    if (isNaN(days) || days <= 0) {
      return next(new CustomError(400, "dueDays must be a positive number"));
    }
    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + days);
    filter.dueDate = { $gte: now, $lte: end };
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("storefrontId", "locationName locationCode")
      .populate("ordersProducts.inventoryId", "productName productCode SKU")
      .populate("creditPersonId", "name phone")
      .populate("soldBy", "name role"),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    message: "Orders fetched successfully",
    data: orders,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const getOrders = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }
  const order = await Order.findOne({ _id: orderId, isDeleted: false })
    .populate("storefrontId", "locationName locationCode")
    .populate("ordersProducts.inventoryId", "productName productCode SKU")
    .populate("creditPersonId", "name phone")
    .populate("soldBy", "name role");

  if (!order) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    message: "Order fetched successfully",
    data: order,
  });
});

// Update/add credit person ID to an order
export const updateOrderCreditPersonId = asyncErrorHandler(
  async (req, res, next) => {
    const { orderId } = req.params;
    const { creditPersonId } = req.body;

    // Validate orderId
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return next(new CustomError(400, "Invalid order ID format"));
    }

    // Validate creditPersonId is provided
    if (!creditPersonId) {
      return next(new CustomError(400, "Credit person ID is required"));
    }

    if (!mongoose.Types.ObjectId.isValid(creditPersonId)) {
      return next(new CustomError(400, "Invalid credit person ID format"));
    }

    // Start MongoDB session for transaction
    const session = await mongoose.startSession();

    try {
      // Start transaction
      await session.withTransaction(async () => {
        // 1. Validate order exists and is not deleted
        const order = await Order.findById(orderId).session(session);

        if (!order) {
          throw new CustomError(404, "Order not found");
        }

        if (order.isDeleted) {
          throw new CustomError(400, "Cannot update deleted order");
        }

        // 2. Validate order is a credit order
        if (order.paymentType !== "credit") {
          throw new CustomError(
            400,
            "Can only add credit person to credit orders. This order is not a credit order.",
          );
        }

        // 3. Validate credit person exists
        const creditPerson =
          await CreditPerson.findById(creditPersonId).session(session);

        if (!creditPerson) {
          throw new CustomError(404, "Credit person not found");
        }

        // 4. Check if credit person is blacklisted
        if (creditPerson.blacklist) {
          throw new CustomError(
            400,
            `Cannot add blacklisted credit person to order: ${
              creditPerson.blacklistReason || "No reason provided"
            }`,
          );
        }

        // 4a. Check credit limit
        if (creditPerson.creditLimit != null) {
          const additionalAmount = order.finalAmount - order.paidAmount;
          if (additionalAmount > 0) {
            await checkCreditLimit(creditPersonId, additionalAmount, session);
          }
        }

        // 5. Update order with credit person ID
        order.creditPersonId = new mongoose.Types.ObjectId(creditPersonId);
        await order.save({ session });

        // 6. Populate references for response
        await order.populate("storefrontId", "storefrontName storefrontCode");
        await order.populate("creditPersonId", "name phone");
        await order.populate(
          "ordersProducts.inventoryId",
          "productName productCode SKU",
        );

        // 7. Send response
        res.status(200).json({
          success: true,
          message: "Credit person ID updated successfully",
          data: order,
        });
      });
    } catch (error) {
      // Handle transaction errors
      if (error instanceof CustomError) {
        return next(error);
      }

      // Handle validation errors
      if (error.name === "ValidationError") {
        const errors = Object.values(error.errors).map((val) => val.message);
        return next(
          new CustomError(400, `Validation error: ${errors.join(". ")}`),
        );
      }

      // For other errors, log and return with actual error message
      console.error("Update credit person ID error:", error);
      const errorMessage =
        error?.message || String(error) || "Unknown error occurred";
      return next(
        new CustomError(
          500,
          `Failed to update credit person ID: ${errorMessage}`,
        ),
      );
    } finally {
      // Always end the session
      await session.endSession();
    }
  },
);

// Update order paid amount
export const updateOrderPaidAmount = asyncErrorHandler(
  async (req, res, next) => {
    const { orderId } = req.params;
    const { paidAmount } = req.body;

    // Validate orderId
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return next(new CustomError(400, "Invalid order ID format"));
    }

    // Validate paidAmount is provided
    if (paidAmount === undefined || paidAmount === null) {
      return next(new CustomError(400, "Paid amount is required"));
    }

    // Validate paidAmount is a number
    if (typeof paidAmount !== "number" || isNaN(paidAmount)) {
      return next(new CustomError(400, "Paid amount must be a valid number"));
    }

    // Validate paidAmount is not negative
    if (paidAmount < 0) {
      return next(new CustomError(400, "Paid amount cannot be negative"));
    }

    // Start MongoDB session for transaction
    const session = await mongoose.startSession();

    try {
      // Start transaction
      await session.withTransaction(async () => {
        // 1. Validate order exists and is not deleted
        const order = await Order.findById(orderId).session(session);

        if (!order) {
          throw new CustomError(404, "Order not found");
        }

        if (order.isDeleted) {
          throw new CustomError(400, "Cannot update deleted order");
        }

        // 1a. Check credit limit if reducing paidAmount on a credit order
        if (order.creditPersonId && order.paymentType === "credit" && paidAmount < (order.paidAmount || 0)) {
          const reduction = (order.paidAmount || 0) - paidAmount;
          await checkCreditLimit(order.creditPersonId, reduction, session);
        }

        // 2. Update order paid amount
        order.paidAmount = paidAmount;
        await order.save({ session });

        // 3. Populate references for response
        await order.populate("storefrontId", "locationName locationCode");
        await order.populate(
          "ordersProducts.inventoryId",
          "productName productCode SKU",
        );
        await order.populate("creditPersonId", "name phone");
        await order.populate("soldBy", "name role");

        // 4. Send response
        res.status(200).json({
          success: true,
          message: "Order paid amount updated successfully",
          data: order,
        });
      });
    } catch (error) {
      // Handle transaction errors
      if (error instanceof CustomError) {
        return next(error);
      }

      // Handle validation errors
      if (error.name === "ValidationError") {
        const errors = Object.values(error.errors).map((val) => val.message);
        return next(
          new CustomError(400, `Validation error: ${errors.join(". ")}`),
        );
      }

      // For other errors, log and return with actual error message
      console.error("Update order paid amount error:", error);
      const errorMessage =
        error?.message || String(error) || "Unknown error occurred";
      return next(
        new CustomError(
          500,
          `Failed to update order paid amount: ${errorMessage}`,
        ),
      );
    } finally {
      // Always end the session
      await session.endSession();
    }
  },
);

export const updateOrderDueDate = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const { dueDate } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (dueDate !== null && dueDate !== undefined) {
    const parsed = new Date(dueDate);
    if (isNaN(parsed.getTime())) {
      return next(new CustomError(400, "Invalid due date format"));
    }
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new CustomError(404, "Order not found");
      if (order.isDeleted) throw new CustomError(400, "Cannot update deleted order");

      order.dueDate = dueDate ? new Date(dueDate) : null;
      await order.save({ session });

      await order.populate("storefrontId", "locationName locationCode");
      await order.populate("ordersProducts.inventoryId", "productName productCode SKU");
      await order.populate("creditPersonId", "name phone");
      await order.populate("soldBy", "name role");

      res.status(200).json({
        success: true,
        message: "Due date updated successfully",
        data: order,
      });
    });
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(new CustomError(400, `Validation error: ${errors.join(". ")}`));
    }
    console.error("Update due date error:", error);
    return next(new CustomError(500, `Failed to update due date: ${error.message}`));
  } finally {
    await session.endSession();
  }
});

export const updateOrderTransportFee = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const { transportFee, finalAmount, paidAmount } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (transportFee === undefined || transportFee === null || transportFee < 0) {
    return next(new CustomError(400, "Valid transportFee is required (min 0)"));
  }

  if (paidAmount !== undefined && paidAmount !== null && paidAmount < 0) {
    return next(new CustomError(400, "paidAmount cannot be negative"));
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new CustomError(404, "Order not found");
      if (order.isDeleted) throw new CustomError(400, "Cannot update deleted order");

      const oldTransportFee = order.transportFee || 0;
      order.transportFee = transportFee;

      if (finalAmount !== undefined && finalAmount !== null) {
        order.finalAmount = finalAmount;
      } else {
        order.finalAmount = (order.finalAmount || 0) - oldTransportFee + transportFee;
      }

      if (order.finalAmount < 0) {
        throw new CustomError(400, "Final amount cannot be negative");
      }

      if (paidAmount !== undefined && paidAmount !== null) {
        order.paidAmount = paidAmount;
      }

      await order.save({ session });

      await order.populate("storefrontId", "locationName locationCode");
      await order.populate("ordersProducts.inventoryId", "productName productCode SKU");
      await order.populate("creditPersonId", "name phone");
      await order.populate("soldBy", "name role");

      res.status(200).json({
        success: true,
        message: "Transport fee updated successfully",
        data: order,
      });
    });
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(new CustomError(400, `Validation error: ${errors.join(". ")}`));
    }
    console.error("Update transport fee error:", error);
    return next(new CustomError(500, `Failed to update transport fee: ${error.message}`));
  } finally {
    await session.endSession();
  }
});

export const getOrdersByStorefrontId = asyncErrorHandler(
  async (req, res, next) => {
    const { storefrontId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
      return next(new CustomError(400, "Invalid storefront ID format"));
    }

    const orders = await Order.find({
      storefrontId: storefrontId,
      saleType: "storefront",
      isDeleted: false,
    })
      .sort({ createdAt: -1 }) // Sort by newest first
      .populate("storefrontId", "locationName locationCode")
      .populate("ordersProducts.inventoryId", "productName productCode SKU")
      .populate("creditPersonId", "name phone")
      .populate("soldBy", "name role");

    res.status(200).json({
      success: true,
      message: "Orders fetched successfully",
      data: {
        count: orders.length,
        orders,
      },
    });
  },
);

// Add order items to existing order
export const addOrderItems = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const {
    items,
    subTotal,
    tax,
    discount,
    finalAmount,
    extraChange,
    paidAmount,
    transportFee,
  } = req.body;

  // Validate orderId
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  // Validate required fields - items array
  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(
      new CustomError(400, "Items array is required and must not be empty"),
    );
  }

  // Validate each item in the array
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.inventoryId) {
      return next(
        new CustomError(400, `Item at index ${i}: Inventory ID is required`),
      );
    }

    if (!mongoose.Types.ObjectId.isValid(item.inventoryId)) {
      return next(
        new CustomError(400, `Item at index ${i}: Invalid inventory ID format`),
      );
    }

    if (!item.quantity || item.quantity < 1) {
      return next(
        new CustomError(
          400,
          `Item at index ${i}: Quantity is required and must be at least 1`,
        ),
      );
    }
  }

  // Validate numeric fields if provided
  if (tax !== undefined && tax < 0) {
    return next(new CustomError(400, "Tax cannot be negative"));
  }

  if (discount !== undefined && discount < 0) {
    return next(new CustomError(400, "Discount cannot be negative"));
  }

  if (finalAmount !== undefined && finalAmount < 0) {
    return next(new CustomError(400, "Final amount cannot be negative"));
  }

  if (paidAmount !== undefined && paidAmount < 0) {
    return next(new CustomError(400, "Paid amount cannot be negative"));
  }

  if (extraChange !== undefined && extraChange < 0) {
    return next(new CustomError(400, "Extra change cannot be negative"));
  }

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    // Start transaction
    await session.withTransaction(async () => {
      // 1. Validate order exists and is not deleted
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new CustomError(404, "Order not found");
      }

      if (order.isDeleted) {
        throw new CustomError(400, "Cannot modify deleted order");
      }

      // 1a. Validate order status is completed (only completed orders can be modified after checkout)
      if (order.orderStatus !== "completed") {
        throw new CustomError(
          400,
          `Cannot add items to order with status '${order.orderStatus}'. Only completed orders can be modified.`,
        );
      }

      // 2. Get all unique inventory IDs to fetch in batch
      const inventoryIds = items.map(
        (item) => new mongoose.Types.ObjectId(item.inventoryId),
      );

      // 3. Validate all inventory items exist and get their selling prices
      const inventoryItems = await Inventory.find({
        _id: { $in: inventoryIds },
      }).session(session);

      if (inventoryItems.length !== inventoryIds.length) {
        const foundIds = inventoryItems.map((item) => item._id.toString());
        const missingIds = inventoryIds.filter(
          (id) => !foundIds.includes(id.toString()),
        );
        throw new CustomError(
          404,
          `Inventory items not found: ${missingIds.join(", ")}`,
        );
      }

      // Map inventory items by ID for easy lookup
      const inventoryMap = new Map();
      inventoryItems.forEach((item) => {
        inventoryMap.set(item._id.toString(), item);
      });

      // 4. Validate all items and check stock availability before processing
      const stockRecordsMap = new Map();
      for (const item of items) {
        const inventoryId = new mongoose.Types.ObjectId(item.inventoryId);
        const inventoryItem = inventoryMap.get(inventoryId.toString());

        if (!inventoryItem) {
          throw new CustomError(
            404,
            `Inventory item not found: ${item.inventoryId}`,
          );
        }

        if (
          inventoryItem.sellingPrice === undefined ||
          inventoryItem.sellingPrice === null
        ) {
          throw new CustomError(
            400,
            `Product '${inventoryItem.productCode}' (${inventoryItem.productName}) does not have a selling price set`,
          );
        }

        if (inventoryItem.sellingPrice < 0) {
          throw new CustomError(
            400,
            `Product '${inventoryItem.productCode}' (${inventoryItem.productName}) has an invalid selling price: ${inventoryItem.sellingPrice}`,
          );
        }

        // Check stock availability
        const stockRecord = await StorefrontInventory.findOne(
          {
            inventoryId: inventoryId,
            storefrontId: order.storefrontId,
          },
          null,
          { session },
        );

        if (!stockRecord) {
          throw new CustomError(
            404,
            `Stock record not found for product '${inventoryItem.productCode}' in storefront`,
          );
        }

        // UOM conversion: compute base quantity for stock check
        let factor = 1;
        let baseQuantity = item.quantity;
        if (item.unit && inventoryItem.uomConversions?.length > 0) {
          const conversion = inventoryItem.uomConversions.find(
            (c) => c.unit?.toLowerCase() === String(item.unit).toLowerCase(),
          );
          if (conversion) {
            factor = conversion.factor;
            baseQuantity = item.quantity / factor;
          }
        }

        // Check stock availability (stock is in base units)
        const availableQuantity = stockRecord.quantity || 0;
        if (availableQuantity < baseQuantity) {
          throw new CustomError(
            400,
            `Insufficient stock for product '${inventoryItem.productCode}' (${inventoryItem.productName}). Available: ${availableQuantity}, Requested: ${baseQuantity}`,
          );
        }

        // Store stock record for later use
        stockRecordsMap.set(inventoryId.toString(), stockRecord);
      }

      // 5. Process all items - add to order and deduct stock
      for (const item of items) {
        const inventoryId = new mongoose.Types.ObjectId(item.inventoryId);
        const inventoryItem = inventoryMap.get(inventoryId.toString());
        const stockRecord = stockRecordsMap.get(inventoryId.toString());

        // UOM conversion for this item
        let factor = 1;
        let unit = item.unit || inventoryItem.unitOfMeasure || null;
        let baseQuantity = item.quantity;
        if (item.unit && inventoryItem.uomConversions?.length > 0) {
          const conversion = inventoryItem.uomConversions.find(
            (c) => c.unit?.toLowerCase() === String(item.unit).toLowerCase(),
          );
          if (conversion) {
            factor = conversion.factor;
            unit = conversion.unit;
            baseQuantity = item.quantity / factor;
          }
        }

        const unitPrice = inventoryItem.sellingPrice / factor;

        // Check if item already exists in order
        const existingItemIndex = order.ordersProducts.findIndex(
          (orderItem) =>
            orderItem.inventoryId.toString() === inventoryId.toString(),
        );

        if (existingItemIndex !== -1) {
          // Item exists, increase quantity and baseQuantity
          order.ordersProducts[existingItemIndex].quantity += item.quantity;
          order.ordersProducts[existingItemIndex].baseQuantity += baseQuantity;
        } else {
          // Item doesn't exist, add new item
          order.ordersProducts.push({
            inventoryId,
            unit,
            factor,
            quantity: item.quantity,
            baseQuantity,
            unitPrice,
          });
        }

        // Deduct stock using baseQuantity
        stockRecord.quantity -= baseQuantity;
        stockRecord.lastUpdated = new Date();
        await stockRecord.save({ session });
      }

      // 6. Update order fields if provided
      if (subTotal !== undefined && subTotal !== null) {
        order.subTotal = subTotal;
      }

      if (tax !== undefined && tax !== null) {
        order.tax = tax;
      }

      if (discount !== undefined && discount !== null) {
        order.discount = discount;
      }

      if (transportFee !== undefined && transportFee !== null) {
        order.transportFee = transportFee;
      }

      if (finalAmount !== undefined && finalAmount !== null) {
        if (order.creditPersonId) {
          const oldOutstanding = (order.finalAmount || 0) - (order.paidAmount || 0);
          const newOutstanding = finalAmount - (order.paidAmount || 0);
          if (newOutstanding > oldOutstanding) {
            await checkCreditLimit(order.creditPersonId, newOutstanding - oldOutstanding, session);
          }
        }
        order.finalAmount = finalAmount;
      }

      if (paidAmount !== undefined && paidAmount !== null) {
        order.paidAmount = paidAmount;
      }

      if (extraChange !== undefined && extraChange !== null) {
        order.extraChange = extraChange;
      }

      // 7. Save order
      await order.save({ session });

      // 8. Populate references for response
      await order.populate("storefrontId", "locationName locationCode");
      await order.populate(
        "ordersProducts.inventoryId",
        "productName productCode SKU",
      );
      await order.populate("creditPersonId", "name phone");
      await order.populate("soldBy", "name role");

      logActivity({
        admin: req.user._id,
        action: "add_items",
        feature: "order",
        description: `Added items to order ${order.orderNumber}`,
        targetId: order._id,
        targetModel: "Order",
        ip: req.ip,
      });

      // 9. Send response
      res.status(200).json({
        success: true,
        message: "Order items added successfully",
        data: order,
      });
    });
  } catch (error) {
    // Handle transaction errors
    if (error instanceof CustomError) {
      return next(error);
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(
        new CustomError(400, `Validation error: ${errors.join(". ")}`),
      );
    }

    // For other errors, log and return with actual error message
    console.error("Add order items error:", error);
    const errorMessage =
      error?.message || String(error) || "Unknown error occurred";
    return next(
      new CustomError(500, `Failed to add order items: ${errorMessage}`),
    );
  } finally {
    // Always end the session
    await session.endSession();
  }
});

// Remove order items from existing order
export const removeOrderItems = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const {
    items,
    subTotal,
    tax,
    discount,
    finalAmount,
    extraChange,
    paidAmount,
    transportFee,
  } = req.body;

  // Validate orderId
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  // Validate required fields - items array
  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(
      new CustomError(400, "Items array is required and must not be empty"),
    );
  }

  // Validate each item in the array
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.inventoryId) {
      return next(
        new CustomError(400, `Item at index ${i}: Inventory ID is required`),
      );
    }

    if (!mongoose.Types.ObjectId.isValid(item.inventoryId)) {
      return next(
        new CustomError(400, `Item at index ${i}: Invalid inventory ID format`),
      );
    }

    if (!item.quantity || item.quantity < 1) {
      return next(
        new CustomError(
          400,
          `Item at index ${i}: Quantity is required and must be at least 1`,
        ),
      );
    }
  }

  // Validate numeric fields if provided
  if (tax !== undefined && tax < 0) {
    return next(new CustomError(400, "Tax cannot be negative"));
  }

  if (discount !== undefined && discount < 0) {
    return next(new CustomError(400, "Discount cannot be negative"));
  }

  if (finalAmount !== undefined && finalAmount < 0) {
    return next(new CustomError(400, "Final amount cannot be negative"));
  }

  if (paidAmount !== undefined && paidAmount < 0) {
    return next(new CustomError(400, "Paid amount cannot be negative"));
  }

  if (extraChange !== undefined && extraChange < 0) {
    return next(new CustomError(400, "Extra change cannot be negative"));
  }

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    // Start transaction
    await session.withTransaction(async () => {
      // 1. Validate order exists and is not deleted
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new CustomError(404, "Order not found");
      }

      if (order.isDeleted) {
        throw new CustomError(400, "Cannot modify deleted order");
      }

      // 1a. Validate order status is completed (only completed orders can be modified after checkout)
      if (order.orderStatus !== "completed") {
        throw new CustomError(
          400,
          `Cannot remove items from order with status '${order.orderStatus}'. Only completed orders can be modified.`,
        );
      }

      // 2. Validate all items exist in order and check quantities before processing
      const itemsToProcess = [];
      for (const item of items) {
        const inventoryId = new mongoose.Types.ObjectId(item.inventoryId);
        const existingItemIndex = order.ordersProducts.findIndex(
          (orderItem) =>
            orderItem.inventoryId.toString() === inventoryId.toString(),
        );

        if (existingItemIndex === -1) {
          throw new CustomError(
            404,
            `Item with inventoryId '${item.inventoryId}' not found in order. Cannot remove item that doesn't exist.`,
          );
        }

        const existingItem = order.ordersProducts[existingItemIndex];

        // Validate quantity to remove - items should not go beyond zero
        // Ensure we cannot remove more than what exists in the order
        if (item.quantity > existingItem.quantity) {
          throw new CustomError(
            400,
            `Cannot remove ${item.quantity} items for inventoryId '${item.inventoryId}'. Only ${existingItem.quantity} items exist in order. Cannot remove more than available.`,
          );
        }

        itemsToProcess.push({
          inventoryId,
          quantity: item.quantity,
          existingItemIndex,
          existingItem,
        });
      }

      // 3. Process all items - remove from order and restore stock
      // Process in reverse order to avoid index shifting issues when removing items
      const sortedItemsToProcess = itemsToProcess.sort(
        (a, b) => b.existingItemIndex - a.existingItemIndex,
      );

      for (const itemToProcess of sortedItemsToProcess) {
        const { inventoryId, quantity, existingItemIndex, existingItem } =
          itemToProcess;

        // Calculate base quantity to restore (use existing item's factor)
        const factor = existingItem.factor || 1;
        const restoreBaseQty = quantity / factor;

        // Calculate new quantity (in selling unit)
        const newQuantity = existingItem.quantity - quantity;
        const newBaseQuantity = existingItem.baseQuantity != null
          ? existingItem.baseQuantity - restoreBaseQty
          : null;

        // Update or remove item
        if (newQuantity <= 0) {
          // Remove item from array if quantity becomes zero or negative
          order.ordersProducts.splice(existingItemIndex, 1);
        } else {
          // Update quantity and baseQuantity
          order.ordersProducts[existingItemIndex].quantity = newQuantity;
          if (order.ordersProducts[existingItemIndex].baseQuantity != null) {
            order.ordersProducts[existingItemIndex].baseQuantity = newBaseQuantity;
          }
        }

        // Restore stock (in base units)
        const stockRecord = await StorefrontInventory.findOne(
          {
            inventoryId: inventoryId,
            storefrontId: order.storefrontId,
          },
          null,
          { session },
        );

        if (!stockRecord) {
          // If stock record doesn't exist, create it
          await StorefrontInventory.create(
            [
              {
                inventoryId: inventoryId,
                storefrontId: order.storefrontId,
                quantity: restoreBaseQty,
                lastUpdated: new Date(),
              },
            ],
            { session },
          );
        } else {
          // Restore stock to existing record
          stockRecord.quantity += restoreBaseQty;
          stockRecord.lastUpdated = new Date();
          await stockRecord.save({ session });
        }
      }

      // 8. Update order fields if provided
      if (subTotal !== undefined && subTotal !== null) {
        order.subTotal = subTotal;
      }

      if (tax !== undefined && tax !== null) {
        order.tax = tax;
      }

      if (discount !== undefined && discount !== null) {
        order.discount = discount;
      }

      if (transportFee !== undefined && transportFee !== null) {
        order.transportFee = transportFee;
      }

      if (finalAmount !== undefined && finalAmount !== null) {
        order.finalAmount = finalAmount;
      }

      if (paidAmount !== undefined && paidAmount !== null) {
        order.paidAmount = paidAmount;
      }

      if (extraChange !== undefined && extraChange !== null) {
        order.extraChange = extraChange;
      }

      // 9. Save order
      await order.save({ session });

      // 10. Populate references for response
      await order.populate("storefrontId", "locationName locationCode");
      await order.populate(
        "ordersProducts.inventoryId",
        "productName productCode SKU",
      );
      await order.populate("creditPersonId", "name phone");
      await order.populate("soldBy", "name role");

      logActivity({
        admin: req.user._id,
        action: "remove_items",
        feature: "order",
        description: `Removed items from order ${order.orderNumber}`,
        targetId: order._id,
        targetModel: "Order",
        ip: req.ip,
      });

      // 11. Send response
      res.status(200).json({
        success: true,
        message: "Order items removed successfully",
        data: order,
      });
    });
  } catch (error) {
    // Handle transaction errors
    if (error instanceof CustomError) {
      return next(error);
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(
        new CustomError(400, `Validation error: ${errors.join(". ")}`),
      );
    }

    // For other errors, log and return with actual error message
    console.error("Remove order items error:", error);
    const errorMessage =
      error?.message || String(error) || "Unknown error occurred";
    return next(
      new CustomError(500, `Failed to remove order items: ${errorMessage}`),
    );
  } finally {
    // Always end the session
    await session.endSession();
  }
});

export const hardDeleteOrder = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  // 1. Find the order first to validate it exists and check conditions
  const order = await Order.findById(orderId);
  if (!order) {
    return next(new CustomError(404, "Order not found"));
  }

  // 2. Validate order items - order cannot be hard deleted if it has order items
  if (
    order.ordersProducts &&
    Array.isArray(order.ordersProducts) &&
    order.ordersProducts.length > 0
  ) {
    return next(
      new CustomError(
        400,
        "Cannot hard delete order with order items. Order must have empty order items or empty array to be deleted.",
      ),
    );
  }

  // 3. Check if order has credit records - order cannot be hard deleted if it has credit records
  const creditRecordsCount = await CreditRecord.countDocuments({
    orderId: orderId,
    isDeleted: false,
  });

  if (creditRecordsCount > 0) {
    return next(
      new CustomError(
        400,
        `Cannot hard delete order with credit records. This order has ${creditRecordsCount} credit record(s) associated with it.`,
      ),
    );
  }

  // 4. All validations passed, proceed with hard delete
  const deletedOrder = await Order.findByIdAndDelete(orderId);
  if (!deletedOrder) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    message: "Order hard deleted successfully",
    data: deletedOrder,
  });
});
