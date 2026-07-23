import mongoose from "mongoose";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { validatePhoneNumber } from "../utils/phoneValidation.utils.js";
import { logActivity } from "../services/activityLog.service.js";
import LocationProfile from "../models/locationProfile.model.js";

// Create new warehouse profile
export const createWarehouseProfile = asyncErrorHandler(
  async (req, res, next) => {
    const {
      warehouseCode,
      warehouseName,
      warehouseAddress,
      warehousePhone,
      warehouseEmail,
      managerName,
      status,
      description,
      notes,
    } = req.body;

    // Check if warehouseCode already exists
    if (warehouseCode) {
      const existingCode = await LocationProfile.findOne({
        type: "warehouse",
        locationCode: warehouseCode.toUpperCase(),
        isDeleted: false,
      });
      if (existingCode) {
        return next(new CustomError(400, "Warehouse code already exists"));
      }
    }

    // Check if warehouseName already exists
    if (warehouseName) {
      const existingName = await LocationProfile.findOne({
        type: "warehouse",
        locationName: warehouseName.trim(),
        isDeleted: false,
      });
      if (existingName) {
        return next(new CustomError(400, "Warehouse name already exists"));
      }
    }

    // Validate phone number
    const phoneValidation = validatePhoneNumber(warehousePhone, "MM");
    if (!phoneValidation.isValid) {
      return next(new CustomError(400, phoneValidation.error));
    }

    // Prepare warehouse data
    const warehouseData = {
      type: "warehouse",
      locationCode: warehouseCode?.toUpperCase().trim(),
      locationName: warehouseName?.trim(),
      locationAddress: warehouseAddress?.trim(),
      locationPhone: phoneValidation.formattedNumber,
      locationEmail: warehouseEmail?.toLowerCase().trim() || null,
      managerName: managerName?.trim() || null,
      status: status || "active",
      description: description?.trim() || undefined,
      notes: notes?.trim() || undefined,
    };

    const newWarehouseProfile = await LocationProfile.create(warehouseData);

    logActivity({
      admin: req.user._id,
      action: "create",
      feature: "warehouse_profile",
      description: `Created warehouse ${newWarehouseProfile.locationName}`,
      targetId: newWarehouseProfile._id,
      targetModel: "LocationProfile",
      ip: req.ip,
    });
    res.status(201).json({
      success: true,
      message: "Warehouse profile created successfully",
      data: newWarehouseProfile,
    });
  }
);

// Get all warehouse profiles
export const getAllWarehouseProfiles = asyncErrorHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeDeleted = false,
    } = req.query;

    // Build query - exclude soft deleted by default, filter by warehouse type
    const query = { type: "warehouse" };

    if (!includeDeleted || includeDeleted === "false") {
      query.isDeleted = false;
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { locationName: { $regex: search, $options: "i" } },
        { locationCode: { $regex: search, $options: "i" } },
        { locationAddress: { $regex: search, $options: "i" } },
        { managerName: { $regex: search, $options: "i" } },
      ];
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Execute query
    const warehouses = await LocationProfile.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count for pagination
    const total = await LocationProfile.countDocuments(query);

    res.status(200).json({
      success: true,
      message: "Warehouse profiles retrieved successfully",
      data: warehouses,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  }
);

// Get warehouse profile by ID
export const getWarehouseProfileById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid warehouse profile ID format"));
    }

    const warehouse = await LocationProfile.findOne({
      _id: id,
      type: "warehouse",
      isDeleted: false,
    });

    if (!warehouse) {
      return next(new CustomError(404, "Warehouse profile not found"));
    }

    res.status(200).json({
      success: true,
      message: "Warehouse profile retrieved successfully",
      data: warehouse,
    });
  }
);

// Update warehouse profile
export const updateWarehouseProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const {
      warehouseCode,
      warehouseName,
      warehouseAddress,
      warehousePhone,
      warehouseEmail,
      managerName,
      status,
      description,
      notes,
    } = req.body;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid warehouse profile ID format"));
    }

    // Check if warehouse exists and is not deleted
    const existingWarehouse = await LocationProfile.findOne({
      _id: id,
      type: "warehouse",
      isDeleted: false,
    });

    if (!existingWarehouse) {
      return next(new CustomError(404, "Warehouse profile not found"));
    }

    // Build update fields object
    const updateFields = {};

    // Check if warehouseCode is being updated and validate uniqueness
    if (warehouseCode !== undefined) {
      const codeToCheck = warehouseCode.toUpperCase().trim();
      if (codeToCheck !== existingWarehouse.locationCode) {
        const existingCode = await LocationProfile.findOne({
          type: "warehouse",
          locationCode: codeToCheck,
          isDeleted: false,
          _id: { $ne: id },
        });
        if (existingCode) {
          return next(new CustomError(400, "Warehouse code already exists"));
        }
      }
      updateFields.locationCode = codeToCheck;
    }

    // Check if warehouseName is being updated and validate uniqueness
    if (warehouseName !== undefined) {
      const nameToCheck = warehouseName.trim();
      if (nameToCheck !== existingWarehouse.locationName) {
        const existingName = await LocationProfile.findOne({
          type: "warehouse",
          locationName: nameToCheck,
          isDeleted: false,
          _id: { $ne: id },
        });
        if (existingName) {
          return next(new CustomError(400, "Warehouse name already exists"));
        }
      }
      updateFields.locationName = nameToCheck;
    }

    // Update address if provided
    if (warehouseAddress !== undefined) {
      updateFields.locationAddress = warehouseAddress.trim();
    }

    // Validate and update phone number if provided
    if (warehousePhone !== undefined) {
      const phoneValidation = validatePhoneNumber(warehousePhone, "MM");
      if (!phoneValidation.isValid) {
        return next(new CustomError(400, phoneValidation.error));
      }
      updateFields.locationPhone = phoneValidation.formattedNumber;
    }

    // Update email if provided
    if (warehouseEmail !== undefined) {
      updateFields.locationEmail = warehouseEmail
        ? warehouseEmail.toLowerCase().trim()
        : null;
    }

    // Update manager name if provided
    if (managerName !== undefined) {
      updateFields.managerName = managerName ? managerName.trim() : null;
    }

    // Update status if provided
    if (status !== undefined) {
      if (!["active", "inactive"].includes(status)) {
        return next(
          new CustomError(400, "Status must be either 'active' or 'inactive'")
        );
      }
      updateFields.status = status;
    }

    // Update description if provided
    if (description !== undefined) {
      updateFields.description = description.trim();
    }

    // Update notes if provided
    if (notes !== undefined) {
      updateFields.notes = notes.trim();
    }

    // Check if there are any fields to update
    if (Object.keys(updateFields).length === 0) {
      return next(new CustomError(400, "No valid fields to update"));
    }

    // Update the warehouse profile
    const updatedWarehouse = await LocationProfile.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    logActivity({
      admin: req.user._id,
      action: "update",
      feature: "warehouse_profile",
      description: `Updated warehouse ${updatedWarehouse.locationName}`,
      targetId: updatedWarehouse._id,
      targetModel: "LocationProfile",
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Warehouse profile updated successfully",
      data: updatedWarehouse,
    });
  }
);
