import mongoose from "mongoose";

const shopSettingSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      required: [true, "Shop name is required"],
      trim: true,
      maxlength: [100, "Shop name cannot exceed 100 characters"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      validate: {
        validator: function (value) {
          // Basic phone number validation - can be enhanced based on requirements
          return /^[0-9+\-\s()]+$/.test(value);
        },
        message: "Invalid phone number format",
      },
    },
    logo: {
      type: String,
      default: null, // URL to Cloudflare R2 hosted image
    },
    logoKey: {
      type: String,
      default: null, // R2 object key for deletion/replacement
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (value) {
          if (!value) return true; // Email is optional
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        },
        message: "Invalid email format",
      },
    },
    taxId: {
      type: String,
      trim: true,
      default: null,
    },
    currency: {
      type: String,
      enum: ["USD", "MMK", "EUR", "GBP", "JPY", "CNY"],
      default: "MMK",
    },
    taxRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    businessHours: {
      monday: { open: String, close: String, closed: { type: Boolean, default: false } },
      tuesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      wednesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      thursday: { open: String, close: String, closed: { type: Boolean, default: false } },
      friday: { open: String, close: String, closed: { type: Boolean, default: false } },
      saturday: { open: String, close: String, closed: { type: Boolean, default: false } },
      sunday: { open: String, close: String, closed: { type: Boolean, default: true } },
    },
    socialMedia: {
      facebook: { type: String, trim: true, default: null },
      instagram: { type: String, trim: true, default: null },
      website: { type: String, trim: true, default: null },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatted phone number
shopSettingSchema.virtual("formattedPhoneNumber").get(function () {
  if (!this.phoneNumber) return "";
  // Basic formatting - can be enhanced
  return this.phoneNumber.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
});

// Static method to get current shop settings
shopSettingSchema.statics.getCurrentSettings = async function () {
  const settings = await this.findOne({ isActive: true })
    .populate("updatedBy", "name role")
    .sort({ updatedAt: -1 });
  return settings;
};

// Index for faster queries
shopSettingSchema.index({ isActive: 1 });

const ShopSetting = mongoose.model("ShopSetting", shopSettingSchema);
export default ShopSetting;
