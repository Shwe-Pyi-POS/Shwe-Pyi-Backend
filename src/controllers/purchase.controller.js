import mongoose from "mongoose";
import Purchasing from "../models/purchasing.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import Inventory from "../models/inventory.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

export const createPurchase = asyncErrorHandler(async (req, res, next) => {
  const { supplierId, products, note, totalAmount } = req.body;
  const purchasedBy = req.user._id;

  if (!supplierId || !products || products.length === 0) {
    return next(new CustomError(400, "Supplier ID and products are required"));
  }

  // Fetch product details for each product in the purchase
  const productsWithDetails = await Promise.all(
    products.map(async (item) => {
      if (!item.inventoryId || !item.purchaseQuantity) {
        throw new CustomError(
          400,
          `Product must have inventoryId and purchaseQuantity`
        );
      }

      const inventoryItem = await Inventory.findById(item.inventoryId);

      if (!inventoryItem) {
        throw new CustomError(
          404,
          `Product with ID ${item.inventoryId} not found`
        );
      }

      return {
        inventoryId: inventoryItem._id,
        productName: inventoryItem.productName,
        productCode: inventoryItem.productCode,
        buyingPrice: inventoryItem.buyingPrice,
        purchaseQuantity: item.purchaseQuantity,
      };
    })
  );

  // Generate PO number
  const poNumber = await Purchasing.generatePONumber();

  const purchase = await Purchasing.create({
    poNumber,
    supplierId,
    products: productsWithDetails,
    note: note || "No note available",
    totalAmount,
    status: "pending",
    purchasedBy,
  });

  logActivity({
    admin: purchasedBy,
    action: "create",
    feature: "purchase",
    description: `Created PO ${purchase.poNumber} - ${purchase.totalAmount} MMK`,
    targetId: purchase._id,
    targetModel: "Purchasing",
    metadata: { status: purchase.status, totalAmount: purchase.totalAmount },
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: "Purchase created successfully",
    data: purchase,
  });
});

export const getAllPurchases = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    isDeleted,
    status,
  } = req.query;

  // Build query
  const query = {};

  // Filter by isDeleted status if provided
  // Supports: ?isDeleted=true, ?isDeleted=false, or omit to default to false
  if (isDeleted !== undefined) {
    // Convert string "true"/"false" to boolean
    if (isDeleted === "true" || isDeleted === true) {
      query.isDeleted = true;
    } else if (isDeleted === "false" || isDeleted === false) {
      query.isDeleted = false;
    } else {
      return next(
        new CustomError(
          400,
          "Invalid isDeleted value. Must be 'true' or 'false'."
        )
      );
    }
  } else {
    // Default: exclude deleted purchases if isDeleted is not specified
    query.isDeleted = false;
  }

  // Filter by status if provided
  if (status !== undefined) {
    const validStatuses = [
      "pending",
      "confirmed",
      "arrived",
      "cancelled",
      "completed",
    ];
    if (!validStatuses.includes(status)) {
      return next(
        new CustomError(
          400,
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`
        )
      );
    }
    query.status = status;
  }

  // Add date range filter using dateFilter utility
  // Filter by the 'createdAt' field (when the purchase was created)
  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
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

  // Execute query with population
  const purchases = await Purchasing.find(query)
    .populate("purchasedBy", "name role")
    .populate("supplierId", "supplierName supplierCode")
    .sort(sort)
    .skip(skip)
    .limit(limitNum);

  // Calculate totalRemainingQuantity for each purchase
  // Convert to plain objects and add totalRemainingQuantity field
  const purchasesWithTotalRemaining = purchases.map((purchase) => {
    const purchaseObj = purchase.toObject({ virtuals: true });

    // Calculate totalRemainingQuantity by summing all products' remainingQuantity
    // Use virtual field if available, otherwise calculate manually
    const totalRemainingQuantity = purchase.products.reduce(
      (total, product) => {
        // Try to use virtual field first, fallback to manual calculation
        const remainingQty =
          product.remainingQuantity !== undefined
            ? product.remainingQuantity
            : (product.purchaseQuantity || 0) - (product.receivedQuantity || 0);
        return total + Math.max(0, remainingQty); // Ensure non-negative
      },
      0
    );

    // Add totalRemainingQuantity after products section
    return {
      ...purchaseObj,
      totalRemainingQuantity,
    };
  });

  // Get total count for pagination
  const total = await Purchasing.countDocuments(query);

  res.status(200).json({
    success: true,
    message: "All purchases retrieved successfully",
    data: purchasesWithTotalRemaining,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const getPurchaseById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Exclude deleted purchases by default
  const includeDeleted = req.query.includeDeleted === "true";
  const query = includeDeleted ? { _id: id } : { _id: id, isDeleted: false };

  const purchase = await Purchasing.findOne(query).populate(
    "purchasedBy",
    "name role"
  );

  if (!purchase) {
    return next(new CustomError(404, "Purchase not found"));
  }

  res.status(200).json({
    success: true,
    message: "Purchase retrieved successfully",
    data: purchase,
  });
});

export const updatePurchaseStatus = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { status } = req.body;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }

    if (!status) {
      return next(new CustomError(400, "Status is required"));
    }

    const validStatuses = ["pending", "confirmed", "arrived", "cancelled"];
    if (!validStatuses.includes(status)) {
      return next(
        new CustomError(
          400,
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`
        )
      );
    }

    // First, check if the purchase exists and if it's soft-deleted
    const existingPurchase = await Purchasing.findById(id);

    if (!existingPurchase) {
      return next(new CustomError(404, "Purchase order not found"));
    }

    // Validate that the purchase is not soft-deleted
    if (existingPurchase.isDeleted === true) {
      return next(
        new CustomError(
          400,
          "Cannot update status of a soft-deleted purchase order. Please restore the purchase order first."
        )
      );
    }

    // Update the status
    const purchase = await Purchasing.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { status },
      { new: true, runValidators: true }
    );

    if (!purchase) {
      return next(new CustomError(404, "Purchase order not found"));
    }

    logActivity({
      admin: req.user._id,
      action: "update_status",
      feature: "purchase",
      description: `Updated PO ${purchase.poNumber} status to ${purchase.status}`,
      targetId: purchase._id,
      targetModel: "Purchasing",
      metadata: { status: purchase.status },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Purchase status updated successfully",
      data: purchase,
    });
  }
);

// Soft delete purchase order
export const softDeletePurchase = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Find the purchase order
  const purchase = await Purchasing.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  // Soft delete: set isDeleted to true and deletedAt to current date
  purchase.isDeleted = true;
  purchase.deletedAt = new Date();
  await purchase.save();

  logActivity({
    admin: req.user._id,
    action: "delete",
    feature: "purchase",
    description: `Deleted PO ${purchase.poNumber}`,
    targetId: purchase._id,
    targetModel: "Purchasing",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Purchase order soft deleted successfully",
    data: purchase,
  });
});

export const restorePurchase = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid purchase order ID format"));
  }

  // Find the purchase order
  const purchase = await Purchasing.findOne({
    _id: id,
    isDeleted: true,
  });

  if (!purchase) {
    return next(new CustomError(404, "Purchase order not found"));
  }

  // Restore: set isDeleted to false and deletedAt to null
  purchase.isDeleted = false;
  purchase.deletedAt = null;
  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Purchase order restored successfully",
    data: purchase,
  });
});
