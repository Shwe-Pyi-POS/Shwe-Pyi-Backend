import mongoose from "mongoose";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";
import Purchasing from "../models/purchasing.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import { logActivity } from "../services/activityLog.service.js";

// Create new GRN (Supports Partial GRN - Can receive one or more items from PO)
export const createGRN = asyncErrorHandler(async (req, res, next) => {
  const { purchasingId, grnDate, lineItems, notes } = req.body;

  // Validate purchasingId
  if (!purchasingId) {
    return next(new CustomError(400, "Purchase order ID is required"));
  }

  if (!mongoose.Types.ObjectId.isValid(purchasingId)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Fetch PO with products
  const purchaseOrder = await Purchasing.findById(purchasingId).lean(); // Use lean() to get plain JS object
  if (!purchaseOrder) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  // Validate PO status - only "arrived" status allows GRN creation
  if (purchaseOrder.status !== "arrived") {
    return next(
      new CustomError(
        400,
        `Cannot create GRN for purchase order with status '${purchaseOrder.status}'. Only purchase orders with status 'arrived' can have GRN created.`
      )
    );
  }

  // Check if PO has products
  if (!purchaseOrder.products || purchaseOrder.products.length === 0) {
    return next(new CustomError(400, "Purchase order has no products"));
  }

  // Validate line items (user provides only goodQuantity and badQuantity)
  // System auto-creates line items from PO products
  // warehouseId is optional - can be set later via transfer records
  if (!lineItems || !Array.isArray(lineItems)) {
    return next(
      new CustomError(
        400,
        "Line items are required as an array. Provide goodQuantity and badQuantity for each product from the purchase order. warehouseId is optional and can be set later via transfer records."
      )
    );
  }

  if (lineItems.length === 0) {
    return next(
      new CustomError(
        400,
        "At least one line item is required. Provide goodQuantity and badQuantity for products from the purchase order."
      )
    );
  }

  // Create a map of user-provided line items by productCode for easy lookup
  const userLineItemsMap = new Map();
  lineItems.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return next(
        new CustomError(400, `Line item at index ${index} must be an object`)
      );
    }
    if (!item.productCode) {
      return next(
        new CustomError(
          400,
          `Line item at index ${index} is missing 'productCode'. Each line item must have a productCode to match products from the purchase order.`
        )
      );
    }
    const productCodeUpper = item.productCode.toUpperCase();
    if (userLineItemsMap.has(productCodeUpper)) {
      return next(
        new CustomError(
          400,
          `Duplicate productCode '${item.productCode}' found in line items. Each product can only appear once per GRN.`
        )
      );
    }
    userLineItemsMap.set(productCodeUpper, item);
  });

  // Create a map of PO products by productCode for efficient lookup
  const poProductsByCode = new Map();
  purchaseOrder.products.forEach((poProduct) => {
    const code = poProduct.productCode.toUpperCase();
    poProductsByCode.set(code, poProduct);
  });

  // Build GRN line items from user-provided line items (partial GRN support)
  const grnLineItems = [];
  let calculatedTotalAmount = 0;

  // Process only the products that user wants to receive (partial GRN)
  for (const [productCodeUpper, userItem] of userLineItemsMap) {
    // Find the corresponding PO product
    const poProduct = poProductsByCode.get(productCodeUpper);
    if (!poProduct) {
      return next(
        new CustomError(
          400,
          `Product with productCode '${userItem.productCode}' not found in purchase order.`
        )
      );
    }
    // Get inventoryId from PO product, or look it up by productCode if missing
    let inventoryIdValue = poProduct.inventoryId;

    // If inventoryId is missing, try to find it by productCode
    if (
      !inventoryIdValue ||
      !mongoose.Types.ObjectId.isValid(inventoryIdValue)
    ) {
      const inventoryItem = await Inventory.findOne({
        productCode: poProduct.productCode.toUpperCase(),
      });

      if (!inventoryItem) {
        return next(
          new CustomError(
            404,
            `Inventory item with productCode '${poProduct.productCode}' not found. Please ensure the product exists in inventory.`
          )
        );
      }

      inventoryIdValue = inventoryItem._id;
    }

    // Ensure inventoryId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(inventoryIdValue)) {
      return next(
        new CustomError(
          400,
          `Invalid inventoryId format for product '${poProduct.productCode}'. Expected valid MongoDB ObjectId.`
        )
      );
    }

    // Convert to ObjectId
    inventoryIdValue = new mongoose.Types.ObjectId(inventoryIdValue);

    // Validate quantities (user only provides goodQuantity and badQuantity)
    if (
      userItem.goodQuantity === undefined ||
      userItem.badQuantity === undefined
    ) {
      return next(
        new CustomError(
          400,
          `goodQuantity and badQuantity are required for product '${poProduct.productCode}'`
        )
      );
    }

    if (userItem.goodQuantity < 0 || userItem.badQuantity < 0) {
      return next(new CustomError(400, "Quantities cannot be negative"));
    }

    // Calculate receivedQuantity from goodQuantity + badQuantity
    const calculatedReceivedQuantity =
      userItem.goodQuantity + userItem.badQuantity;

    // Check if receivedQuantity is provided in the request (optional)
    const providedReceivedQuantity = userItem.receivedQuantity;

    // Validate that goodQuantity + badQuantity equals receivedQuantity
    if (providedReceivedQuantity !== undefined) {
      // If receivedQuantity is provided, validate it matches the sum
      if (
        typeof providedReceivedQuantity !== "number" ||
        providedReceivedQuantity < 0
      ) {
        return next(
          new CustomError(
            400,
            `For product '${poProduct.productCode}' (${poProduct.productName}): receivedQuantity must be a non-negative number.`
          )
        );
      }

      if (providedReceivedQuantity !== calculatedReceivedQuantity) {
        return next(
          new CustomError(
            400,
            `For product '${poProduct.productCode}' (${poProduct.productName}): Validation failed - goodQuantity (${userItem.goodQuantity}) + badQuantity (${userItem.badQuantity}) = ${calculatedReceivedQuantity}, but receivedQuantity is ${providedReceivedQuantity}. These values must be equal. Please ensure: goodQuantity + badQuantity = receivedQuantity.`
          )
        );
      }
      // Use the provided receivedQuantity (which matches the calculated value)
      var receivedQuantity = providedReceivedQuantity;
    } else {
      // If receivedQuantity is not provided, auto-calculate it
      var receivedQuantity = calculatedReceivedQuantity;
    }

    // Explicit validation: Ensure goodQuantity + badQuantity always equals receivedQuantity
    // This is a final check to ensure data integrity
    const sumOfGoodAndBad = userItem.goodQuantity + userItem.badQuantity;
    if (receivedQuantity !== sumOfGoodAndBad) {
      return next(
        new CustomError(
          400,
          `For product '${poProduct.productCode}' (${poProduct.productName}): Data integrity validation failed. goodQuantity (${userItem.goodQuantity}) + badQuantity (${userItem.badQuantity}) = ${sumOfGoodAndBad}, but receivedQuantity is ${receivedQuantity}. These values must always be equal. Please ensure: goodQuantity + badQuantity = receivedQuantity.`
        )
      );
    }

    // Validate that receivedQuantity doesn't exceed remaining purchaseQuantity
    // purchaseQuantity = original order quantity (never modified)
    // receivedQuantity = total received from all GRNs
    // remainingQuantity = purchaseQuantity - receivedQuantity
    const poPurchaseQuantity = poProduct.purchaseQuantity || 0;
    const poReceivedQuantity = poProduct.receivedQuantity || 0;
    const remainingQuantity = poPurchaseQuantity - poReceivedQuantity;

    // Validate that new receivedQuantity doesn't exceed remaining quantity
    if (receivedQuantity > remainingQuantity) {
      return next(
        new CustomError(
          400,
          `Received quantity (${receivedQuantity}) for product '${poProduct.productCode}' (${poProduct.productName}) exceeds remaining purchase order quantity. Already received: ${poReceivedQuantity}, Remaining: ${remainingQuantity}, Total ordered: ${poPurchaseQuantity}.`
        )
      );
    }

    // Validate that at least some quantity is being received
    if (receivedQuantity <= 0) {
      return next(
        new CustomError(
          400,
          `Received quantity must be greater than 0 for product '${poProduct.productCode}'.`
        )
      );
    }

    // Use unitPrice from request or fallback to PO's buyingPrice
    const unitPrice =
      userItem.unitPrice !== undefined
        ? userItem.unitPrice
        : poProduct.buyingPrice;
    if (unitPrice < 0) {
      return next(new CustomError(400, "Unit price cannot be negative"));
    }

    // Calculate totalPrice = receivedQuantity * unitPrice
    // You pay for what you receive (good + bad), not just good quantity
    const totalPrice = receivedQuantity * unitPrice;

    // Build line item with all data auto-filled from PO
    const grnLineItem = {
      inventoryId: inventoryIdValue, // Auto-filled from PO or looked up by productCode
      receivedQuantity: receivedQuantity, // Auto-calculated: goodQuantity + badQuantity
      goodQuantity: userItem.goodQuantity, // User provides
      badQuantity: userItem.badQuantity, // User provides
      unitPrice: unitPrice, // Uses PO's buyingPrice if not provided
      totalPrice: totalPrice, // Auto-calculated: receivedQuantity * unitPrice (pay for all received items)
      notes: userItem.notes || null,
    };

    grnLineItems.push(grnLineItem);
    calculatedTotalAmount += totalPrice;
  }

  // Note: Per-product validation is already done above
  // This is a final safety check (though redundant, it's kept for extra safety)
  // Individual product validations ensure receivedQuantity <= remainingQuantity for each product

  // Generate GRN number
  const grnNumber = await GoodsRecievedNote.generateGRNNumber();

  // Create GRN
  const grnData = {
    grnNumber,
    purchasingId,
    grnDate: grnDate || new Date(),
    lineItems: grnLineItems,
    notes: notes || null,
    totalAmount: calculatedTotalAmount, // Auto-calculated
    status: "pending",
  };

  const newGRN = await GoodsRecievedNote.create(grnData);

  // Increment receivedQuantity in PO for each product
  // purchaseQuantity remains unchanged (preserves original order quantity)
  // receivedQuantity tracks total received from all GRNs
  // If purchaseQuantity === receivedQuantity, update productStatus to "seperated"
  for (const grnLineItem of grnLineItems) {
    // First, increment receivedQuantity
    await Purchasing.updateOne(
      {
        _id: purchasingId,
        "products.inventoryId": grnLineItem.inventoryId,
      },
      {
        $inc: {
          "products.$.receivedQuantity": grnLineItem.receivedQuantity,
        },
      }
    );
  }

  // After updating all receivedQuantities, fetch the updated PO to check status updates
  const updatedPO = await Purchasing.findById(purchasingId).lean();

  // Check ALL products in the PO to ensure their status is correct
  // This handles cases where multiple GRNs might affect different products
  for (const product of updatedPO.products) {
    const purchaseQty = product.purchaseQuantity || 0;
    const receivedQty = product.receivedQuantity || 0;
    const currentStatus = product.productStatus;

    // If purchaseQuantity equals receivedQuantity, status should be "seperated"
    if (purchaseQty === receivedQty && currentStatus !== "seperated") {
      await Purchasing.updateOne(
        {
          _id: purchasingId,
          "products.inventoryId": product.inventoryId,
        },
        {
          $set: {
            "products.$.productStatus": "seperated",
          },
        }
      );
    }
    // If purchaseQuantity does NOT equal receivedQuantity, status should be "pending"
    else if (purchaseQty !== receivedQty && currentStatus !== "pending") {
      await Purchasing.updateOne(
        {
          _id: purchasingId,
          "products.inventoryId": product.inventoryId,
        },
        {
          $set: {
            "products.$.productStatus": "pending",
          },
        }
      );
    }
  }

  // Populate references for response
  await newGRN.populate("purchasingId", "status totalAmount");
  await newGRN.populate(
    "lineItems.inventoryId",
    "productName productCode SKU sellingPrice"
  );

  logActivity({
    admin: req.user._id,
    action: "create",
    feature: "grn",
    description: `Created GRN ${newGRN.grnNumber} - ${newGRN.totalAmount} MMK`,
    targetId: newGRN._id,
    targetModel: "GoodsRecievedNote",
    metadata: { totalAmount: newGRN.totalAmount, status: newGRN.status },
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: "GRN created successfully",
    data: newGRN,
  });
});

// Get all GRNs
export const getAllGRN = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    purchasingId,
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    includeDeleted = false,
  } = req.query;

  // Build query
  const query = {};

  if (!includeDeleted || includeDeleted === "false") {
    query.isDeleted = false;
  }

  if (purchasingId) {
    if (!mongoose.Types.ObjectId.isValid(purchasingId)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }
    query.purchasingId = purchasingId;
  }

  if (status) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { grnNumber: { $regex: search, $options: "i" } },
      { notes: { $regex: search, $options: "i" } },
    ];
  }

  // Add date range filter using dateFilter utility
  // Filter by the 'grnDate' field (when the GRN was created/received)
  try {
    const dateFilter = createDateFilter(req.query, "grnDate", false);
    Object.assign(query, dateFilter);
  } catch (error) {
    // If it's a CustomError, pass it to error handler
    if (error instanceof CustomError) {
      return next(error);
    }
    // For other errors, wrap and pass
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // Pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // Sort
  const sort = {};
  sort[sortBy] = sortOrder === "asc" ? 1 : -1;

  // Execute query with population (include sellingPrice for profit calculations)
  const grns = await GoodsRecievedNote.find(query)
    .populate({
      path: "purchasingId",
      select: "status totalAmount supplierId poNumber",
      populate: {
        path: "supplierId",
        select: "supplierName supplierCode",
      },
    })
    .populate(
      "lineItems.inventoryId",
      "productName productCode SKU buyingPrice sellingPrice"
    )
    .sort(sort)
    .skip(skip)
    .limit(limitNum);

  // Get total count for pagination
  const total = await GoodsRecievedNote.countDocuments(query);

  res.status(200).json({
    success: true,
    message: "GRNs retrieved successfully",
    data: grns,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

// Get GRN by ID
export const getGRNById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid GRN ID format"));
  }

  const grn = await GoodsRecievedNote.findOne({
    _id: id,
    isDeleted: false,
  })
    .populate({
      path: "purchasingId",
      select: "status totalAmount products supplierId poNumber",
      populate: {
        path: "supplierId",
        select: "supplierName supplierCode",
      },
    })
    .populate(
      "lineItems.inventoryId",
      "productName productCode SKU category buyingPrice sellingPrice"
    );

  if (!grn) {
    return next(new CustomError(404, "GRN not found"));
  }

  res.status(200).json({
    success: true,
    message: "GRN retrieved successfully",
    data: grn,
  });
});

export const updateGRNStatus = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  const grn = await GoodsRecievedNote.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  if (!grn) {
    return next(new CustomError(404, "GRN not found"));
  }

  logActivity({
    admin: req.user._id,
    action: "update_status",
    feature: "grn",
    description: `Updated GRN ${grn.grnNumber} status to ${grn.status}`,
    targetId: grn._id,
    targetModel: "GoodsRecievedNote",
    metadata: { status: grn.status },
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "GRN status updated successfully",
    data: grn,
  });
});

// Update GRN lineItems (goodQuantity and badQuantity)
export const updateGRNLineItems = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { lineItems } = req.body;

  // Validate GRN ID format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid GRN ID format"));
  }

  // Validate lineItems
  if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
    return next(
      new CustomError(
        400,
        "Line items are required as an array with at least one item."
      )
    );
  }

  // Find the GRN
  const grn = await GoodsRecievedNote.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!grn) {
    return next(new CustomError(404, "GRN not found"));
  }

  // Validate and update each line item
  for (const updateItem of lineItems) {
    // Validate required fields
    if (!updateItem.lineItemId) {
      return next(
        new CustomError(
          400,
          "lineItemId is required for each line item update."
        )
      );
    }

    if (
      updateItem.goodQuantity === undefined ||
      updateItem.badQuantity === undefined
    ) {
      return next(
        new CustomError(
          400,
          "goodQuantity and badQuantity are required for each line item update."
        )
      );
    }

    // Validate quantities are non-negative
    if (updateItem.goodQuantity < 0 || updateItem.badQuantity < 0) {
      return next(
        new CustomError(400, "goodQuantity and badQuantity cannot be negative.")
      );
    }

    // Find the line item in the GRN
    const lineItem = grn.lineItems.id(updateItem.lineItemId);
    if (!lineItem) {
      return next(
        new CustomError(
          400,
          `Line item with ID ${updateItem.lineItemId} not found in GRN.`
        )
      );
    }

    // Validate that goodQuantity + badQuantity equals receivedQuantity
    const sumOfGoodAndBad = updateItem.goodQuantity + updateItem.badQuantity;
    if (sumOfGoodAndBad !== lineItem.receivedQuantity) {
      return next(
        new CustomError(
          400,
          `For line item ${updateItem.lineItemId}: goodQuantity (${updateItem.goodQuantity}) + badQuantity (${updateItem.badQuantity}) = ${sumOfGoodAndBad}, but receivedQuantity is ${lineItem.receivedQuantity}. These values must be equal. Please ensure: goodQuantity + badQuantity = receivedQuantity.`
        )
      );
    }

    // Validate that transferredQuantity doesn't exceed new goodQuantity
    if (updateItem.goodQuantity < lineItem.transferredQuantity) {
      return next(
        new CustomError(
          400,
          `For line item ${updateItem.lineItemId}: Cannot set goodQuantity (${updateItem.goodQuantity}) less than transferredQuantity (${lineItem.transferredQuantity}). Some quantity has already been transferred.`
        )
      );
    }

    // Update the line item
    lineItem.goodQuantity = updateItem.goodQuantity;
    lineItem.badQuantity = updateItem.badQuantity;

    // Update notes if provided
    if (updateItem.notes !== undefined) {
      lineItem.notes = updateItem.notes || null;
    }
  }

  // Recalculate totalAmount based on updated line items
  const newTotalAmount = grn.lineItems.reduce(
    (total, item) => total + item.totalPrice,
    0
  );
  grn.totalAmount = newTotalAmount;

  // Save the updated GRN
  await grn.save();

  // Populate references for response
  await grn.populate({
    path: "purchasingId",
    select: "status totalAmount supplierId poNumber",
    populate: {
      path: "supplierId",
      select: "supplierName supplierCode",
    },
  });
  await grn.populate(
    "lineItems.inventoryId",
    "productName productCode SKU category buyingPrice sellingPrice"
  );

  logActivity({
    admin: req.user._id,
    action: "update_line_items",
    feature: "grn",
    description: `Updated line items for GRN ${grn.grnNumber}`,
    targetId: grn._id,
    targetModel: "GoodsRecievedNote",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "GRN line items updated successfully",
    data: grn,
  });
});
