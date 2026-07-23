import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import Expense from "../models/expense.model.js";
import { logActivity } from "../services/activityLog.service.js";
import mongoose from "mongoose";
import { createDateFilter } from "../utils/dateFilter.utils.js";

export const createExpense = asyncErrorHandler(async (req, res, next) => {
  const {
    category,
    amount,
    date,
    notes,
    locationId: bodyLocationId,
  } = req.body;

  // Use locationId from user if available, otherwise use from request body
  // This allows owners and admins (who might not have locationId) to create expenses
  const locationId = req.user.locationId || bodyLocationId;
  const adminId = req.user._id;

  // Validate that locationId is provided
  if (!locationId) {
    return next(
      new CustomError(
        400,
        "Location ID is required. Please provide locationId in the request body.",
      ),
    );
  }

  if (!mongoose.Types.ObjectId.isValid(locationId)) {
    return next(new CustomError(400, "Invalid location ID format"));
  }
  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    return next(new CustomError(400, "Invalid admin ID format"));
  }
  const expense = await Expense.create({
    category,
    amount,
    date,
    notes,
    locationId,
    adminId,
  });
  logActivity({
    admin: adminId,
    action: "create",
    feature: "expense",
    description: `Created expense ${expense.category} - ${expense.amount} MMK`,
    targetId: expense._id,
    targetModel: "Expense",
    metadata: { category: expense.category, amount: expense.amount },
    ip: req.ip,
  });
  res.status(201).json({
    success: true,
    message: "Expense created successfully.",
    data: expense,
  });
});

export const getExpenseById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid expense ID format"));
  }
  const expense = await Expense.findById(id)
    .populate({
      path: "locationId",
      select: "type locationName locationCode locationAddress",
    })
    .populate({
      path: "adminId",
      select: "name role",
    });
  if (!expense) {
    return next(new CustomError(404, "Expense not found"));
  }
  res.status(200).json({
    success: true,
    message: "Expense fetched successfully.",
    data: expense,
  });
});

export const getExpenses = asyncErrorHandler(async (req, res, next) => {
  // Build query filter
  const filter = {};
  const {
    softDeleted,
    page,
    limit,
    sortBy = "date",
    sortOrder = "desc",
    category,
    locationId,
  } = req.query;

  // Filter by softDeleted status if provided
  if (softDeleted !== undefined) {
    if (softDeleted === "true" || softDeleted === true) {
      filter.softDeleted = true;
    } else if (softDeleted === "false" || softDeleted === false) {
      filter.softDeleted = false;
    } else {
      return next(
        new CustomError(
          400,
          "Invalid softDeleted value. Must be 'true' or 'false'.",
        ),
      );
    }
  } else {
    filter.softDeleted = false;
  }

  // Filter by category if provided
  if (category) {
    filter.category = category;
  }

  // Filter by locationId if provided
  if (locationId) {
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return next(new CustomError(400, "Invalid location ID format"));
    }
    filter.locationId = locationId;
  }

  // Add date range filter using dateFilter utility
  try {
    const dateFilter = createDateFilter(req.query, "date", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) {
      return next(error);
    }
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // Sort
  const sort = {};
  sort[sortBy] = sortOrder === "asc" ? 1 : -1;

  // Pagination
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Execute query with pagination if requested
  const usePagination = page !== undefined || limit !== undefined;
  let queryChain = Expense.find(filter).sort(sort);

  if (usePagination) {
    queryChain = queryChain.skip(skip).limit(limitNum);
  }

  const expenses = await queryChain
    .populate({
      path: "locationId",
      select: "type locationName locationCode locationAddress",
    })
    .populate({
      path: "adminId",
      select: "name role",
    });

  // Get total count for pagination info
  const total = await Expense.countDocuments(filter);

  const response = {
    success: true,
    message: "Expenses fetched successfully.",
    data: expenses,
  };

  if (usePagination) {
    response.pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    };
  } else {
    response.totalItems = total;
  }

  res.status(200).json(response);
});

export const updateExpense = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { category, amount, date, notes } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid expense ID format"));
  }

  // Get adminId from authenticated user
  const adminId = req.user._id;
  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    return next(new CustomError(400, "Invalid admin ID format"));
  }

  const expense = await Expense.findByIdAndUpdate(
    id,
    { category, amount, date, notes, adminId },
    { new: true, runValidators: true },
  )
    .populate({
      path: "locationId",
      select: "type locationName locationCode locationAddress",
    })
    .populate({
      path: "adminId",
      select: "name role",
    });

  if (!expense) {
    return next(new CustomError(404, "Expense not found"));
  }
  logActivity({
    admin: req.user._id,
    action: "update",
    feature: "expense",
    description: `Updated expense ${expense.category} - ${expense.amount} MMK`,
    targetId: expense._id,
    targetModel: "Expense",
    metadata: { category: expense.category, amount: expense.amount },
    ip: req.ip,
  });
  res.status(200).json({
    success: true,
    message: "Expense updated successfully.",
    data: expense,
  });
});

export const softDeleteExpense = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid expense ID format"));
  }
  const expense = await Expense.findById(id);
  if (!expense) {
    return next(new CustomError(404, "Expense not found"));
  }
  if (expense.softDeleted) {
    return next(new CustomError(400, "Expense is already soft deleted"));
  }
  const softDeletedExpense = await Expense.findByIdAndUpdate(
    id,
    { $set: { softDeleted: true, deletedAt: new Date() } },
    { new: true, runValidators: true },
  )
    .populate({
      path: "locationId",
      select: "type locationName locationCode locationAddress",
    })
    .populate({
      path: "adminId",
      select: "name role",
    });
  if (!softDeletedExpense) {
    return next(new CustomError(404, "Expense not found"));
  }
  logActivity({
    admin: req.user._id,
    action: "delete",
    feature: "expense",
    description: `Soft deleted expense ${softDeletedExpense.category}`,
    targetId: softDeletedExpense._id,
    targetModel: "Expense",
    ip: req.ip,
  });
  res.status(200).json({
    success: true,
    message: "Expense soft deleted successfully",
    data: softDeletedExpense,
  });
});

export const restoreExpense = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid expense ID format"));
  }
  const expense = await Expense.findById(id);
  if (!expense) {
    return next(new CustomError(404, "Expense not found"));
  }
  if (!expense.softDeleted) {
    return next(new CustomError(400, "Expense is not soft deleted"));
  }
  const restoredExpense = await Expense.findByIdAndUpdate(
    id,
    { $set: { softDeleted: false, deletedAt: null } },
    { new: true, runValidators: true },
  )
    .populate({
      path: "locationId",
      select: "type locationName locationCode locationAddress",
    })
    .populate({
      path: "adminId",
      select: "name role",
    });
  if (!restoredExpense) {
    return next(new CustomError(404, "Expense not found"));
  }
  res.status(200).json({
    success: true,
    message: "Expense restored successfully",
    data: restoredExpense,
  });
});

export const deleteExpense = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid expense ID format"));
  }
  const expense = await Expense.findByIdAndDelete(id);
  if (!expense) {
    return next(new CustomError(404, "Expense not found"));
  }
  res.status(200).json({
    success: true,
    message: "Expense deleted successfully.",
    data: expense,
  });
});
