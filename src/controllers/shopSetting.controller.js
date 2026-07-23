import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import ShopSetting from "../models/shopSetting.model.js";
import mongoose from "mongoose";
import multer from "multer";
import { uploadToR2, deleteFromR2, generateR2Key, validateLogoFile } from "../configs/cloudflareR2.config.js";

// Multer configuration for logo upload
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    try {
      validateLogoFile(file);
      cb(null, true);
    } catch (error) {
      cb(new CustomError(400, error.message), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Create or update shop settings
export const createOrUpdateShopSetting = asyncErrorHandler(
  async (req, res, next) => {
    const {
      shopName,
      address,
      phoneNumber,
      email,
      taxId,
      currency,
      taxRate,
      businessHours,
      socialMedia,
      isActive = true,
    } = req.body;

    // Get admin ID from authenticated user
    const adminId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return next(new CustomError(400, "Invalid admin ID format"));
    }

    // Validate required fields
    if (!shopName || !address || !phoneNumber) {
      return next(
        new CustomError(
          400,
          "Shop name, address, and phone number are required"
        )
      );
    }

    // Check if settings already exist
    const existingSettings = await ShopSetting.findOne({ isActive: true });

    let shopSetting;
    let isNewSetting = false;

    if (existingSettings) {
      // Update existing settings
      shopSetting = await ShopSetting.findByIdAndUpdate(
        existingSettings._id,
        {
          shopName,
          address,
          phoneNumber,
          email,
          taxId,
          currency,
          taxRate,
          businessHours,
          socialMedia,
          isActive,
          updatedBy: adminId,
        },
        { new: true, runValidators: true }
      ).populate("updatedBy", "name role");
    } else {
      // Create new settings
      shopSetting = await ShopSetting.create({
        shopName,
        address,
        phoneNumber,
        email,
        taxId,
        currency,
        taxRate,
        businessHours,
        socialMedia,
        isActive,
        updatedBy: adminId,
      });
      
      shopSetting = await shopSetting.populate("updatedBy", "name role");
      isNewSetting = true;
    }

    res.status(isNewSetting ? 201 : 200).json({
      success: true,
      message: isNewSetting
        ? "Shop settings created successfully"
        : "Shop settings updated successfully",
      data: shopSetting,
    });
  }
);

// Upload shop logo
export const uploadShopLogo = asyncErrorHandler(
  async (req, res, next) => {
    // Check if file was uploaded
    if (!req.file) {
      return next(new CustomError(400, "No file uploaded"));
    }

    // Get admin ID from authenticated user
    const adminId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return next(new CustomError(400, "Invalid admin ID format"));
    }

    // Get current shop settings
    const currentSettings = await ShopSetting.findOne({ isActive: true });

    if (!currentSettings) {
      return next(
        new CustomError(
          404,
          "No shop settings found. Please create shop settings first."
        )
      );
    }

    try {
      // Delete old logo if exists
      if (currentSettings.logoKey) {
        await deleteFromR2(currentSettings.logoKey);
      }

      // Upload new logo to R2
      const logoKey = generateR2Key(req.file.originalname);
      const logoUrl = await uploadToR2(req.file, logoKey);

      // Update shop settings with new logo
      const updatedSettings = await ShopSetting.findByIdAndUpdate(
        currentSettings._id,
        {
          logo: logoUrl,
          logoKey: logoKey,
          updatedBy: adminId,
        },
        { new: true, runValidators: true }
      ).populate("updatedBy", "name role");

      res.status(200).json({
        success: true,
        message: "Shop logo uploaded successfully",
        data: {
          logo: logoUrl,
          logoKey: logoKey,
        },
        shopSettings: updatedSettings,
      });
    } catch (error) {
      return next(new CustomError(500, `Failed to upload logo: ${error.message}`));
    }
  }
);

// Get current shop settings
export const getCurrentShopSettings = asyncErrorHandler(
  async (req, res, next) => {
    const settings = await ShopSetting.getCurrentSettings();

    if (!settings) {
      return next(
        new CustomError(
          404,
          "No shop settings found. Please create shop settings first."
        )
      );
    }

    res.status(200).json({
      success: true,
      message: "Shop settings retrieved successfully",
      data: settings,
    });
  }
);

// Delete shop logo
export const deleteShopLogo = asyncErrorHandler(
  async (req, res, next) => {
    // Get admin ID from authenticated user
    const adminId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return next(new CustomError(400, "Invalid admin ID format"));
    }

    // Get current shop settings
    const currentSettings = await ShopSetting.findOne({ isActive: true });

    if (!currentSettings) {
      return next(
        new CustomError(
          404,
          "No shop settings found. Please create shop settings first."
        )
      );
    }

    if (!currentSettings.logoKey) {
      return next(new CustomError(400, "No logo to delete"));
    }

    try {
      // Delete logo from R2
      await deleteFromR2(currentSettings.logoKey);

      // Update shop settings to remove logo
      const updatedSettings = await ShopSetting.findByIdAndUpdate(
        currentSettings._id,
        {
          logo: null,
          logoKey: null,
          updatedBy: adminId,
        },
        { new: true, runValidators: true }
      ).populate("updatedBy", "name role");

      res.status(200).json({
        success: true,
        message: "Shop logo deleted successfully",
        data: updatedSettings,
      });
    } catch (error) {
      return next(new CustomError(500, `Failed to delete logo: ${error.message}`));
    }
  }
);

// Get all shop settings history (for audit trail)
export const getAllShopSettings = asyncErrorHandler(
  async (req, res, next) => {
  const { page, limit, sortBy = "updatedAt", sortOrder = "desc" } = req.query;

  // Sort
  const sort = {};
  sort[sortBy] = sortOrder === "asc" ? 1 : -1;

  // Pagination
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const usePagination = page !== undefined || limit !== undefined;
  let queryChain = ShopSetting.find({}).sort(sort).populate("updatedBy", "name role");

  if (usePagination) {
    queryChain = queryChain.skip(skip).limit(limitNum);
  }

  const settings = await queryChain;
  const total = await ShopSetting.countDocuments();

  const response = {
    success: true,
    message: "Shop settings history retrieved successfully",
    data: settings,
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
  }
);

// Export upload middleware for use in routes
export { upload };
