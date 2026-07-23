import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";
import StockAuditLog from "../models/stockAuditLog.model.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

export const getAllStockAuditLogs = asyncErrorHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      inventoryId,
      action,
      sortBy = "createdAt",
      sortOrder = "desc",
      locationType,
      locationId,
    } = req.query;
    const query = {};
    if (inventoryId) {
      if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
        return next(new CustomError(400, "Invalid inventory ID format"));
      }
      query.inventoryId = inventoryId;
    }
    if (action) {
      query.action = action;
    }
    if (locationType) {
      query.locationType = locationType;
    }
    if (locationId) {
      if (!mongoose.Types.ObjectId.isValid(locationId)) {
        return next(new CustomError(400, "Invalid location ID format"));
      }
      query.locationId = locationId;
    }

    // Add date range filter using dateFilter utility
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

    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    const stockAuditLogs = await StockAuditLog.find(query)
      .populate("inventoryId", "productName productCode SKU category")
      .populate("adminId", "name role")
      .populate("locationId", "locationName locationCode")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);
    const total = await StockAuditLog.countDocuments(query);
    const pagination = {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit,
    };
    res.status(200).json({
      success: true,
      message: "Stock audit logs fetched successfully",
      data: stockAuditLogs,
      pagination,
    });
  }
);

export const getStockAuditLogById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid stock audit log ID format"));
    }
    const stockAuditLog = await StockAuditLog.findById(id)
      .populate("inventoryId", "productName productCode SKU category")
      .populate("adminId", "name role")
      .populate("locationId", "locationName locationCode");
    res.status(200).json({
      success: true,
      message: "Stock audit log fetched successfully",
      data: stockAuditLog,
    });
  }
);
