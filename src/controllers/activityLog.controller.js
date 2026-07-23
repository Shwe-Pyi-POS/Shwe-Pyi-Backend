import mongoose from "mongoose";
import ActivityLog from "../models/activityLog.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

export const getActivityLogs = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    admin,
    action,
    feature,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const filter = {};

  if (admin) {
    if (!mongoose.Types.ObjectId.isValid(admin)) {
      return next(new CustomError(400, "Invalid admin ID format"));
    }
    filter.admin = new mongoose.Types.ObjectId(admin);
  }

  if (action) {
    filter.action = action;
  }

  if (feature) {
    filter.feature = feature;
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

  const [logs, totalCount] = await Promise.all([
    ActivityLog.find(filter)
      .populate("admin", "name role")
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    ActivityLog.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    message: "Activity logs fetched successfully",
    data: {
      logs,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
        totalItems: totalCount,
        itemsPerPage: limitNum,
      },
    },
  });
});

export const getActivityLogById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid activity log ID format"));
  }

  const log = await ActivityLog.findById(id).populate("admin", "name role");

  if (!log) {
    return next(new CustomError(404, "Activity log not found"));
  }

  res.status(200).json({
    success: true,
    message: "Activity log fetched successfully",
    data: log,
  });
});
