import mongoose from "mongoose";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import LocationProfile from "../models/locationProfile.model.js";

// Get all location profiles
export const getAllLocationProfiles = asyncErrorHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      type,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeDeleted = false,
    } = req.query;

    // Build query
    const query = {};

    // Filter by type if provided (warehouse or storefront)
    if (type) {
      if (!["warehouse", "storefront"].includes(type)) {
        return next(
          new CustomError(400, "Type must be either 'warehouse' or 'storefront'")
        );
      }
      query.type = type;
    }

    // Exclude soft deleted by default
    if (!includeDeleted || includeDeleted === "false") {
      query.isDeleted = false;
    }

    // Filter by status if provided
    if (status) {
      if (!["active", "inactive"].includes(status)) {
        return next(
          new CustomError(400, "Status must be either 'active' or 'inactive'")
        );
      }
      query.status = status;
    }

    // Search functionality
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
    const locations = await LocationProfile.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count for pagination
    const total = await LocationProfile.countDocuments(query);

    res.status(200).json({
      success: true,
      message: "Location profiles retrieved successfully",
      data: locations,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  }
);

// Get location profile by ID
export const getLocationProfileById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid location profile ID format"));
    }

    const location = await LocationProfile.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!location) {
      return next(new CustomError(404, "Location profile not found"));
    }

    res.status(200).json({
      success: true,
      message: "Location profile retrieved successfully",
      data: location,
    });
  }
);

