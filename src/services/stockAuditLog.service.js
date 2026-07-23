import StockAuditLog from "../models/stockAuditLog.model.js";
import mongoose from "mongoose";

/**
 * Creates a stock audit log entry for tracking stock quantity changes
 * @param {Object} params - Parameters for the audit log
 * @param {mongoose.Types.ObjectId} params.inventoryId - The inventory/product ID
 * @param {mongoose.Types.ObjectId} params.adminId - The admin/user ID who made the change
 * @param {mongoose.Types.ObjectId} params.locationId - The location (warehouse/storefront) ID
 * @param {string} params.locationType - "warehouse" or "storefront"
 * @param {mongoose.Types.ObjectId} params.stockRecordId - The stock record ID (WarehouseStock or StorefrontInventory)
 * @param {number} params.beforeQuantity - Stock quantity before the change
 * @param {number} params.afterQuantity - Stock quantity after the change
 * @param {number} params.quantityChange - The change amount (positive for add, negative for remove)
 * @param {string} params.action - Action type: "add", "remove", "adjust", "create"
 * @param {string} [params.reason] - Optional reason/notes for the change
 * @param {mongoose.Types.ObjectId} [params.relatedTransactionId] - Optional related transaction ID
 * @param {string} [params.relatedTransactionType] - Optional transaction type: "grn", "order", "purchase", "expense"
 * @param {mongoose.ClientSession} [params.session] - Optional MongoDB session for transactions
 * @returns {Promise<Object>} The created audit log entry
 */
export const createStockAuditLog = async ({
  inventoryId,
  adminId,
  locationId,
  locationType,
  stockRecordId,
  beforeQuantity,
  afterQuantity,
  quantityChange,
  action,
  reason = null,
  relatedTransactionId = null,
  relatedTransactionType = null,
  session = null,
}) => {
  // Validate required fields
  if (!inventoryId || !adminId || !locationId || !locationType || !stockRecordId) {
    throw new Error("Missing required fields for stock audit log");
  }

  if (typeof beforeQuantity !== "number" || typeof afterQuantity !== "number") {
    throw new Error("beforeQuantity and afterQuantity must be numbers");
  }

  if (typeof quantityChange !== "number") {
    throw new Error("quantityChange must be a number");
  }

  if (!["add", "remove", "adjust", "create"].includes(action)) {
    throw new Error(
      "action must be one of: add, remove, adjust, create"
    );
  }

  if (locationType !== "warehouse" && locationType !== "storefront") {
    throw new Error("locationType must be 'warehouse' or 'storefront'");
  }

  // Create the audit log entry
  const auditLogData = {
    inventoryId,
    adminId,
    locationId,
    locationType,
    stockRecordId,
    beforeQuantity,
    afterQuantity,
    quantityChange,
    action,
    reason,
    relatedTransactionId,
    relatedTransactionType,
  };

  // Remove null values for optional fields
  if (reason === null) delete auditLogData.reason;
  if (relatedTransactionId === null) delete auditLogData.relatedTransactionId;
  if (relatedTransactionType === null) delete auditLogData.relatedTransactionType;

  const auditLog = await StockAuditLog.create([auditLogData], {
    session,
  });

  return auditLog[0];
};

/**
 * Determines the action type based on quantity change
 * @param {number} quantityChange - The quantity change (positive or negative)
 * @param {boolean} isInitialCreation - Whether this is the initial stock creation
 * @returns {string} Action type: "create", "add", "remove", or "adjust"
 */
export const determineActionType = (quantityChange, isInitialCreation = false) => {
  if (isInitialCreation) {
    return "create";
  }
  if (quantityChange > 0) {
    return "add";
  }
  if (quantityChange < 0) {
    return "remove";
  }
  return "adjust";
};

