import mongoose from "mongoose";
// import validator from "validator"; // Reserved for future use

const inventorySchema = new mongoose.Schema(
  {
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [200, "Product name cannot exceed 200 characters"],
    },
    productCode: {
      type: String,
      required: [true, "Product code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    saleCode: {
      type: String,
      unique: true,
      sparse: true, // Optional field - allows multiple nulls, enforces uniqueness when provided
      trim: true,
      uppercase: true,
    },
    SKU: {
      type: String,
      sparse: true, // Optional field - allows multiple nulls, enforces uniqueness when provided
      unique: true,
      trim: true,
      uppercase: true,
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values but enforces uniqueness for non-null
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
      default: "Unknown",
    },
    subCategory: {
      type: String,
      trim: true,
      default: "Unknown",
    },
    brand: {
      type: String,
      trim: true,
      default: "Unknown",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
      default: "No description available",
    },
    buyingPrice: {
      type: Number,
      required: [true, "Buying price is required"],
      min: [0, "Buying price cannot be negative"],
    },
    sellingPrice: {
      type: Number,
      required: [true, "Selling price is required"],
      min: [0, "Selling price cannot be negative"],
      validate: {
        validator: function (value) {
          // Selling price should typically be >= buying price
          return value >= this.buyingPrice;
        },
        message:
          "Selling price should be greater than or equal to buying price",
      },
    },
    unitOfMeasure: {
      type: String,
      required: [true, "Unit of measure is required"],
      default: "piece",
    },
    uomConversions: {
      type: [{
        unit: {
          type: String,
          required: [true, "Conversion unit name is required"],
          trim: true,
        },
        factor: {
          type: Number,
          required: [true, "Conversion factor is required"],
          min: [0.001, "Factor must be greater than 0"],
        },
        isDefaultSellingUnit: {
          type: Boolean,
          default: false,
        },
      }],
      _id: false,
    },
    reorderPoint: {
      type: Number,
      min: [0, "Reorder point cannot be negative"],
      default: 0,
    },
    reorderQuantity: {
      type: Number,
      min: [0, "Reorder quantity cannot be negative"],
      default: 0,
    },
    taxRate: {
      type: Number,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
      default: 0,
    },
    status: {
      type: String,
      enum: {
        values: ["active", "inactive", "discontinued"],
        message: "Status must be active, inactive, or discontinued",
      },
      default: "active",
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    images: [
      {
        url: {
          type: String,
        },
        key: {
          type: String,
        },
        isPrimary: {
          type: Boolean,
          default: false,
        },
      },
    ],
    wholesalePrices: {
      type: [{
        quantity: {
          type: Number,
          min: [1, "Quantity must be at least 1"],
        },
        price: {
          type: Number,
          min: [0, "Price cannot be negative"],
        },
      }],
      _id: false,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000, "Note cannot exceed 1000 characters"],
      default: "",
    },
    // createdBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    // },
    // updatedBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    // },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better query performance
// Note: productCode, SKU, saleCode, and barcode already have indexes from unique: true
// Only add indexes for fields that don't have unique: true
inventorySchema.index({ category: 1 });
inventorySchema.index({ category: 1, subCategory: 1 });
inventorySchema.index({ status: 1 });
inventorySchema.index({ productName: "text", description: "text" }); // Text search index

// Virtual for profit margin
inventorySchema.virtual("profitMargin").get(function () {
  if (this.buyingPrice === 0) return 0;
  return ((this.sellingPrice - this.buyingPrice) / this.buyingPrice) * 100;
});

// Virtual for profit amount
inventorySchema.virtual("profitAmount").get(function () {
  return this.sellingPrice - this.buyingPrice;
});

// Pre-save middleware to validate wholesale prices and UOM conversions
inventorySchema.pre("save", function () {
  if (this.wholesalePrices && this.wholesalePrices.length > 0) {
    const quantities = this.wholesalePrices.map((wp) => wp.quantity);
    const uniqueQuantities = new Set(quantities);
    if (quantities.length !== uniqueQuantities.size) {
      throw new Error("Duplicate quantities are not allowed in wholesale prices");
    }
  }
  if (this.uomConversions && this.uomConversions.length > 0) {
    const units = this.uomConversions.map((c) => c.unit?.toLowerCase());
    const uniqueUnits = new Set(units);
    if (units.length !== uniqueUnits.size) {
      throw new Error("Duplicate unit names are not allowed in UOM conversions");
    }
    if (this.unitOfMeasure) {
      const baseLower = this.unitOfMeasure.toLowerCase();
      if (units.includes(baseLower)) {
        throw new Error(`Conversion unit cannot be the same as the base unit "${this.unitOfMeasure}"`);
      }
    }
  }
});

const Inventory = mongoose.model("Inventory", inventorySchema);
export default Inventory;
