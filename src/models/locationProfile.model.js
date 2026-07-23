import mongoose from "mongoose";
import validator from "validator";

const locationProfileSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: {
        values: ["warehouse", "storefront"],
        message: "Type must be warehouse or storefront",
      },
      required: [true, "Location type is required"],
    },
    locationCode: {
      type: String,
      required: [true, "Location code is required"],
      trim: true,
      uppercase: true,
      maxlength: [50, "Location code cannot exceed 50 characters"],
    },
    locationName: {
      type: String,
      required: [true, "Location name is required"],
      trim: true,
      maxlength: [200, "Location name cannot exceed 200 characters"],
    },
    locationAddress: {
      type: String,
      required: [true, "Location address is required"],
      trim: true,
      maxlength: [500, "Location address cannot exceed 500 characters"],
    },
    locationPhone: {
      type: String,
      required: [true, "Location phone is required"],
      trim: true,
      maxlength: [20, "Location phone cannot exceed 20 characters"],
      // Phone validation is handled at controller level using phoneValidation.utils.js
    },
    locationEmail: {
      type: String,
      default: null,
      sparse: true,
      trim: true,
      lowercase: true,
      maxlength: [200, "Location email cannot exceed 200 characters"],
      validate: {
        validator: function (value) {
          if (!value) return true; // Allow null/empty
          return validator.isEmail(value);
        },
        message: "Invalid email format",
      },
    },
    managerName: {
      type: String,
      default: null,
      trim: true,
      maxlength: [200, "Manager name cannot exceed 200 characters"],
    },
    status: {
      type: String,
      enum: {
        values: ["active", "inactive"],
        message: "Status must be active or inactive",
      },
      default: "active",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
      default: "No description available",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: "No notes available",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound unique indexes - locationCode and locationName must be unique per type
locationProfileSchema.index({ type: 1, locationCode: 1 }, { unique: true });
locationProfileSchema.index({ type: 1, locationName: 1 }, { unique: true });

// Indexes for better query performance
locationProfileSchema.index({ type: 1 });
locationProfileSchema.index({ status: 1 });
locationProfileSchema.index({ isDeleted: 1 }); // For soft delete queries
locationProfileSchema.index({ type: 1, status: 1, isDeleted: 1 }); // Compound index for active, non-deleted queries by type
locationProfileSchema.index({ type: 1, locationCode: 1, status: 1 }); // Compound index

const LocationProfile = mongoose.model(
  "LocationProfile",
  locationProfileSchema
);

export default LocationProfile;
