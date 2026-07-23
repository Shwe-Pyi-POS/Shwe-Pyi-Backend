import mongoose from "mongoose";
const Schema = mongoose.Schema;

const stockLogSchema = new Schema(
  {
    inventoryId: {
      type: Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Please provide the inventory ID for the log"],
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Please provide the admin ID for the log"],
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "LocationProfile",
      required: [true, "Please provide the location ID for the log"],
    },
    locationType: {
      type: String,
      enum: {
        values: ["warehouse", "storefront"],
        message: "Location type must be warehouse or storefront",
      },
      required: [true, "Please provide the location type for the log"],
    },
    // Reference to the actual stock record (WarehouseStock or StorefrontInventory)
    stockRecordId: {
      type: Schema.Types.ObjectId,
      required: [true, "Please provide the stock record ID for the log"],
      // Note: This can reference either WarehouseStock or StorefrontInventory
      // We use a generic reference since we can't use ref with conditional models
    },
    // Stock quantity tracking fields
    beforeQuantity: {
      type: Number,
      required: [true, "Please provide the stock quantity before the change"],
      min: [0, "Stock quantity cannot be negative"],
    },
    afterQuantity: {
      type: Number,
      required: [true, "Please provide the stock quantity after the change"],
      min: [0, "Stock quantity cannot be negative"],
    },
    quantityChange: {
      type: Number,
      required: [true, "Please provide the quantity change"],
      // Positive for additions, negative for removals
    },
    action: {
      type: String,
      enum: {
        values: ["add", "remove", "adjust", "create"],
        message: "Action must be one of: add, remove, adjust, create",
      },
      required: [true, "Please provide the action for the log"],
    },
    // Optional reason/notes for the stock change (useful for audit trail)
    reason: {
      type: String,
      trim: true,
      maxlength: [500, "Reason cannot exceed 500 characters"],
      default: null,
    },
    // Reference to related transaction if applicable (e.g., GRN ID, Order ID)
    // Note: Transfers have their own audit trail in transfer.model.js, so not tracked here
    relatedTransactionId: {
      type: Schema.Types.ObjectId,
      default: null,
      // Can reference GRN, Order, Purchase, Expense, etc.
    },
    relatedTransactionType: {
      type: String,
      enum: {
        values: ["grn", "order", "purchase", "expense", null],
        message:
          "Related transaction type must be one of: grn, order, purchase, expense",
      },
      default: null,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
stockLogSchema.index({ inventoryId: 1, locationId: 1 }); // Query by product and location
stockLogSchema.index({ locationId: 1, locationType: 1 }); // Query by location
stockLogSchema.index({ adminId: 1 }); // Query by admin who made the change
stockLogSchema.index({ action: 1 }); // Query by action type
stockLogSchema.index({ createdAt: -1 }); // Query by date (most recent first)
stockLogSchema.index({ stockRecordId: 1 }); // Query by stock record
stockLogSchema.index({ relatedTransactionId: 1, relatedTransactionType: 1 }); // Query by related transaction
stockLogSchema.index({ inventoryId: 1, createdAt: -1 }); // Product history
stockLogSchema.index({ locationId: 1, createdAt: -1 }); // Location history

// Compound index for common queries
stockLogSchema.index({ locationId: 1, locationType: 1, createdAt: -1 });

// Virtual to calculate if this was an increase or decrease
stockLogSchema.virtual("isIncrease").get(function () {
  return this.quantityChange > 0;
});

stockLogSchema.virtual("isDecrease").get(function () {
  return this.quantityChange < 0;
});

const StockAuditLog = mongoose.model("StockAuditLog", stockLogSchema);
export default StockAuditLog;
