/**
 * EXAMPLE: How to use phone validation in controllers
 *
 * This file shows examples of using phoneValidation.utils.js
 * Copy the relevant code to your actual controllers
 */

import pkg from "google-libphonenumber";
const { PhoneNumberFormat } = pkg;
import { asyncErrorHandler } from "./asyncErrorHandler.js";
import CustomError from "./customError.js";
import {
  validatePhoneNumber,
  validatePhoneNumberOrThrow,
  formatPhoneNumber,
} from "./phoneValidation.utils.js";

// ============================================
// EXAMPLE 1: Using validatePhoneNumber (Returns object)
// ============================================
export const exampleController1 = asyncErrorHandler(async (req, res, next) => {
  const { warehousePhone } = req.body;

  // Validate phone number (returns object with isValid, formattedNumber, error)
  const phoneValidation = validatePhoneNumber(warehousePhone, "MM"); // MM = Myanmar

  if (!phoneValidation.isValid) {
    return next(new CustomError(400, phoneValidation.error));
  }

  // Use the formatted phone number
  const formattedPhone = phoneValidation.formattedNumber; // e.g., "+959123456789"

  // Continue with your logic...
  // Save formattedPhone to database instead of raw input
});

// ============================================
// EXAMPLE 2: Using validatePhoneNumberOrThrow (Throws error directly)
// ============================================
export const exampleController2 = asyncErrorHandler(async (req, res, next) => {
  const { warehousePhone } = req.body;

  try {
    // This will throw CustomError if invalid
    const formattedPhone = validatePhoneNumberOrThrow(
      warehousePhone,
      "MM", // Default region
      CustomError
    );

    // If we reach here, phone is valid and formatted
    // formattedPhone contains the formatted number (e.g., "+959123456789")

    // Continue with your logic...
  } catch (error) {
    // Error is already a CustomError, just pass it to next
    return next(error);
  }
});

// ============================================
// EXAMPLE 3: Complete Warehouse Profile Creation Example
// ============================================
export const createWarehouseProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { warehousePhone, warehouseEmail, ...otherData } = req.body;

    // Validate phone number
    const phoneValidation = validatePhoneNumber(warehousePhone, "MM");

    if (!phoneValidation.isValid) {
      return next(new CustomError(400, phoneValidation.error));
    }

    // Prepare data with formatted phone number
    const warehouseData = {
      ...otherData,
      warehousePhone: phoneValidation.formattedNumber, // Use formatted number
      warehouseEmail: warehouseEmail?.toLowerCase().trim() || null,
    };

    // Create warehouse profile
    // const warehouse = await WarehouseProfile.create(warehouseData);

    res.status(201).json({
      success: true,
      message: "Warehouse profile created successfully",
      // data: warehouse,
    });
  }
);

// ============================================
// EXAMPLE 4: Update Warehouse Profile with Phone Validation
// ============================================
export const updateWarehouseProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { warehousePhone, ...updateData } = req.body;

    // If phone is being updated, validate it
    if (warehousePhone) {
      const phoneValidation = validatePhoneNumber(warehousePhone, "MM");

      if (!phoneValidation.isValid) {
        return next(new CustomError(400, phoneValidation.error));
      }

      // Add formatted phone to update data
      updateData.warehousePhone = phoneValidation.formattedNumber;
    }

    // Update warehouse profile
    // const warehouse = await WarehouseProfile.findByIdAndUpdate(
    //   id,
    //   updateData,
    //   { new: true, runValidators: true }
    // );

    res.status(200).json({
      success: true,
      message: "Warehouse profile updated successfully",
      // data: warehouse,
    });
  }
);

// ============================================
// EXAMPLE 5: Format phone number for display
// ============================================
export const formatPhoneForDisplay = (phoneNumber, region = "MM") => {
  // Format as international format (e.g., "+95 9 123 456 789")
  return formatPhoneNumber(
    phoneNumber,
    region,
    PhoneNumberFormat.INTERNATIONAL
  );
};
