import SupplierProfile from "../models/supplierProfile.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";
import { logActivity } from "../services/activityLog.service.js";

export const createSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { supplierName, contactNumber } = req.body;

    if (!supplierName || !contactNumber) {
      return next(new CustomError(400, "All fields are required"));
    }

    const supplier = await SupplierProfile.create({
      supplierName,
      contactNumber,
    });

    logActivity({
      admin: req.user._id,
      action: "create",
      feature: "supplier",
      description: `Created supplier ${supplier.supplierName}`,
      targetId: supplier._id,
      targetModel: "SupplierProfile",
      ip: req.ip,
    });
    res.status(201).json({
      success: true,
      message: "Supplier profile created successfully",
      data: supplier,
    });
  }
);

export const getAllSupplierProfiles = asyncErrorHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeDeleted = false,
      isDeleted,
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    let query = {};

    // Handle isDeleted filter
    if (isDeleted !== undefined) {
      // If isDeleted is explicitly provided, use its boolean value
      query.isDeleted = isDeleted === "true" || isDeleted === true;
    } else if (!includeDeleted || includeDeleted === "false") {
      // If includeDeleted is false or not provided, default to non-deleted only
      query.isDeleted = false;
    }
    // If includeDeleted is true and isDeleted is not provided, don't filter by isDeleted (show all)

    if (search) {
      query.supplierName = { $regex: search, $options: "i" };
    }
    let suppliers = await SupplierProfile.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);
    let total = await SupplierProfile.countDocuments(query);
    res.status(200).json({
      success: true,
      message: "Supplier profiles retrieved successfully",
      data: suppliers,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  }
);

export const getSupplierProfileById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const supplier = await SupplierProfile.findById(id);
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile retrieved successfully",
      data: supplier,
    });
  }
);

export const updateSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { supplierName, contactNumber } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const supplier = await SupplierProfile.findByIdAndUpdate(
      id,
      { $set: { supplierName, contactNumber } },
      { new: true, runValidators: true }
    );
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    logActivity({
      admin: req.user._id,
      action: "update",
      feature: "supplier",
      description: `Updated supplier ${supplier.supplierName}`,
      targetId: supplier._id,
      targetModel: "SupplierProfile",
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Supplier profile updated successfully",
      data: supplier,
    });
  }
);

export const softDeleteSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const supplier = await SupplierProfile.findById(id);
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    if (supplier.isDeleted) {
      return next(
        new CustomError(400, "Supplier profile is already soft deleted")
      );
    }
    const softDeletedSupplier = await SupplierProfile.findByIdAndUpdate(
      id,
      { $set: { isDeleted: true, deletedAt: Date.now() } },
      { new: true, runValidators: true }
    );
    if (!softDeletedSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    logActivity({
      admin: req.user._id,
      action: "delete",
      feature: "supplier",
      description: `Soft deleted supplier ${softDeletedSupplier.supplierName}`,
      targetId: softDeletedSupplier._id,
      targetModel: "SupplierProfile",
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Supplier profile soft deleted successfully",
      data: softDeletedSupplier,
    });
  }
);

export const restoreSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const supplier = await SupplierProfile.findById(id);
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    if (!supplier.isDeleted) {
      return next(new CustomError(400, "Supplier profile is not soft deleted"));
    }
    const restoredSupplier = await SupplierProfile.findByIdAndUpdate(
      id,
      { $set: { isDeleted: false, deletedAt: null } },
      { new: true, runValidators: true }
    );
    if (!restoredSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile restored successfully",
      data: restoredSupplier,
    });
  }
);

export const deleteSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const deletedSupplier = await SupplierProfile.findByIdAndDelete(id);
    if (!deletedSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile deleted successfully",
      data: deletedSupplier,
    });
    if (!deletedSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile deleted successfully",
      data: deletedSupplier,
    });
  }
);
