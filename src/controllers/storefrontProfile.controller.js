import mongoose from "mongoose";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { validatePhoneNumber } from "../utils/phoneValidation.utils.js";
import { logActivity } from "../services/activityLog.service.js";
import LocationProfile from "../models/locationProfile.model.js";

// Create new storefront profile
export const createStorefrontProfile = asyncErrorHandler(
  async (req, res, next) => {
    const {
      storefrontCode,
      storefrontName,
      storefrontAddress,
      storefrontPhone,
      storefrontEmail,
      managerName,
      status,
      description,
      notes,
    } = req.body;

    // Check if storefrontCode already exists
    if (storefrontCode) {
      const existingCode = await LocationProfile.findOne({
        type: "storefront",
        locationCode: storefrontCode.toUpperCase(),
        isDeleted: false,
      });
      if (existingCode) {
        return next(new CustomError(400, "Storefront code already exists"));
      }
    }

    // Check if storefrontName already exists
    if (storefrontName) {
      const existingName = await LocationProfile.findOne({
        type: "storefront",
        locationName: storefrontName.trim(),
        isDeleted: false,
      });
      if (existingName) {
        return next(new CustomError(400, "Storefront name already exists"));
      }
    }

    // Validate phone number
    const phoneValidation = validatePhoneNumber(storefrontPhone, "MM");
    if (!phoneValidation.isValid) {
      return next(new CustomError(400, phoneValidation.error));
    }

    // Prepare storefront data
    const storefrontData = {
      type: "storefront",
      locationCode: storefrontCode?.toUpperCase().trim(),
      locationName: storefrontName?.trim(),
      locationAddress: storefrontAddress?.trim(),
      locationPhone: phoneValidation.formattedNumber,
      locationEmail: storefrontEmail?.toLowerCase().trim() || null,
      managerName: managerName?.trim() || null,
      status: status || "active",
      description: description?.trim() || undefined,
      notes: notes?.trim() || undefined,
    };

    const newStorefrontProfile = await LocationProfile.create(storefrontData);

    logActivity({
      admin: req.user._id,
      action: "create",
      feature: "storefront_profile",
      description: `Created storefront ${newStorefrontProfile.locationName}`,
      targetId: newStorefrontProfile._id,
      targetModel: "LocationProfile",
      ip: req.ip,
    });
    res.status(201).json({
      success: true,
      message: "Storefront profile created successfully",
      data: newStorefrontProfile,
    });
  }
);

// Get all storefront profiles
export const getAllStorefrontProfiles = asyncErrorHandler(
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

    // Build query - exclude soft deleted by default, filter by storefront type
    const query = { type: "storefront" };

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
    const storefronts = await LocationProfile.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count for pagination
    const total = await LocationProfile.countDocuments(query);

    res.status(200).json({
      success: true,
      message: "Storefront profiles retrieved successfully",
      data: storefronts,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  }
);

// Get storefront profile by ID
export const getStorefrontProfileById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid storefront profile ID format"));
    }

    const storefront = await LocationProfile.findOne({
      _id: id,
      type: "storefront",
      isDeleted: false,
    });

    if (!storefront) {
      return next(new CustomError(404, "Storefront profile not found"));
    }

    res.status(200).json({
      success: true,
      message: "Storefront profile retrieved successfully",
      data: storefront,
    });
  }
);

// Update storefront profile
export const updateStorefrontProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const {
      storefrontCode,
      storefrontName,
      storefrontAddress,
      storefrontPhone,
      storefrontEmail,
      managerName,
      status,
      description,
      notes,
    } = req.body;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid storefront profile ID format"));
    }

    // Check if storefront exists and is not deleted
    const existingStorefront = await LocationProfile.findOne({
      _id: id,
      type: "storefront",
      isDeleted: false,
    });

    if (!existingStorefront) {
      return next(new CustomError(404, "Storefront profile not found"));
    }

    // Build update fields object
    const updateFields = {};

    // Check if storefrontCode is being updated and validate uniqueness
    if (storefrontCode !== undefined) {
      const codeToCheck = storefrontCode.toUpperCase().trim();
      if (codeToCheck !== existingStorefront.locationCode) {
        const existingCode = await LocationProfile.findOne({
          type: "storefront",
          locationCode: codeToCheck,
          isDeleted: false,
          _id: { $ne: id },
        });
        if (existingCode) {
          return next(new CustomError(400, "Storefront code already exists"));
        }
      }
      updateFields.locationCode = codeToCheck;
    }

    // Check if storefrontName is being updated and validate uniqueness
    if (storefrontName !== undefined) {
      const nameToCheck = storefrontName.trim();
      if (nameToCheck !== existingStorefront.locationName) {
        const existingName = await LocationProfile.findOne({
          type: "storefront",
          locationName: nameToCheck,
          isDeleted: false,
          _id: { $ne: id },
        });
        if (existingName) {
          return next(new CustomError(400, "Storefront name already exists"));
        }
      }
      updateFields.locationName = nameToCheck;
    }

    // Update address if provided
    if (storefrontAddress !== undefined) {
      updateFields.locationAddress = storefrontAddress.trim();
    }

    // Validate and update phone number if provided
    if (storefrontPhone !== undefined) {
      const phoneValidation = validatePhoneNumber(storefrontPhone, "MM");
      if (!phoneValidation.isValid) {
        return next(new CustomError(400, phoneValidation.error));
      }
      updateFields.locationPhone = phoneValidation.formattedNumber;
    }

    // Update email if provided
    if (storefrontEmail !== undefined) {
      updateFields.locationEmail = storefrontEmail
        ? storefrontEmail.toLowerCase().trim()
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

    // Update the storefront profile
    const updatedStorefront = await LocationProfile.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    logActivity({
      admin: req.user._id,
      action: "update",
      feature: "storefront_profile",
      description: `Updated storefront ${updatedStorefront.locationName}`,
      targetId: updatedStorefront._id,
      targetModel: "LocationProfile",
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Storefront profile updated successfully",
      data: updatedStorefront,
    });
  }
);
