import mongoose from "mongoose";

// GRN Line Item Schema
// Note: inventoryId is automatically filled from PO products by productCode in the controller
const grnLineItemSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
      // Auto-filled from PO product based on productCode (handled in controller)
    },
    receivedQuantity: {
      type: Number,
      required: [true, "Received quantity is required"],
      min: [0, "Received quantity cannot be negative"],
    },
    goodQuantity: {
      type: Number,
      required: [true, "Good quantity is required"],
      min: [0, "Good quantity cannot be negative"],
    },
    badQuantity: {
      type: Number,
      required: [true, "Bad quantity is required"],
      min: [0, "Bad quantity cannot be negative"],
      default: 0,
    },
    transferredQuantity: {
      type: Number,
      required: [true, "Transferred quantity is required"],
      min: [0, "Transferred quantity cannot be negative"],
      default: 0,
      // Tracks how much good quantity has been transferred to warehouses
      // availableQuantity = goodQuantity - transferredQuantity
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price is required"],
      min: [0, "Unit price cannot be negative"],
    },
    totalPrice: {
      type: Number,
      required: [true, "Total price is required"],
      min: [0, "Total price cannot be negative"],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: null,
    },
  },
  {
    _id: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals for GRN line items (profit calculations)
// Note: These work when inventoryId is populated with sellingPrice
grnLineItemSchema.virtual("profitMargin").get(function () {
  // unitPrice is the buying price (cost)
  // sellingPrice comes from populated inventoryId
  const sellingPrice = this.inventoryId?.sellingPrice;

  // Both values must exist and be numbers to calculate profit margin
  if (sellingPrice == null || this.unitPrice == null) return null;
  if (typeof sellingPrice !== "number" || typeof this.unitPrice !== "number")
    return null;

  // Cannot calculate margin if unitPrice (cost) is 0 (division by zero)
  if (this.unitPrice === 0) return null;

  // Calculate profit margin: ((Selling Price - Cost Price) / Cost Price) * 100
  return ((sellingPrice - this.unitPrice) / this.unitPrice) * 100;
});

grnLineItemSchema.virtual("profitAmount").get(function () {
  // unitPrice is the buying price (cost)
  // sellingPrice comes from populated inventoryId
  const sellingPrice = this.inventoryId?.sellingPrice;

  // Both values must exist and be numbers to calculate profit amount
  if (sellingPrice == null || this.unitPrice == null) return null;
  if (typeof sellingPrice !== "number" || typeof this.unitPrice !== "number")
    return null;

  // Calculate profit amount: Selling Price - Cost Price
  // Can be negative (loss) or positive (profit)
  return sellingPrice - this.unitPrice;
});

// Virtual for available quantity (goodQuantity - transferredQuantity)
grnLineItemSchema.virtual("availableQuantity").get(function () {
  const goodQty = this.goodQuantity || 0;
  const transferredQty = this.transferredQuantity || 0;
  return Math.max(0, goodQty - transferredQty);
});

// Main GRN Schema
const goodsRecievedNoteSchema = new mongoose.Schema(
  {
    grnNumber: {
      type: String,
      required: [true, "GRN number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    purchasingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchasing",
      required: [true, "Purchase order is required"],
      // Removed unique: true to allow multiple GRNs per PO for partial receiving
    },
    grnDate: {
      type: Date,
      required: [true, "GRN date is required"],
      default: Date.now,
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "partial", "verified", "rejected"],
        message: "Status must be pending, partial, verified, or rejected",
      },
      default: "pending",
    },
    lineItems: {
      type: [grnLineItemSchema],
      required: [true, "Line items are required"],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "At least one line item is required",
      },
    },
    // receivedBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    //   default: null,
    // },
    // checkedBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    //   default: null,
    // },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
      default: "No notes available.",
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
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

// Validation is handled at controller level for better error handling
// Pre-save hooks can have issues with create() method

// Indexes for better query performance
goodsRecievedNoteSchema.index({ purchasingId: 1 }); // Index for querying GRNs by PO
goodsRecievedNoteSchema.index({ status: 1 });
goodsRecievedNoteSchema.index({ grnDate: 1 });
goodsRecievedNoteSchema.index({ isDeleted: 1 });
goodsRecievedNoteSchema.index({ status: 1, isDeleted: 1 }); // Compound index

// Virtual for total received quantity
goodsRecievedNoteSchema.virtual("totalReceivedQuantity").get(function () {
  return this.lineItems.reduce((sum, item) => sum + item.receivedQuantity, 0);
});

// Virtual for total good quantity
goodsRecievedNoteSchema.virtual("totalGoodQuantity").get(function () {
  return this.lineItems.reduce((sum, item) => sum + item.goodQuantity, 0);
});

// Virtual for total bad quantity
goodsRecievedNoteSchema.virtual("totalBadQuantity").get(function () {
  return this.lineItems.reduce((sum, item) => sum + item.badQuantity, 0);
});

// Static method to generate GRN number
// Format: GRN-YYYY-MM-DD-NNNNNN (e.g., GRN-2024-01-14-000001)
goodsRecievedNoteSchema.statics.generateGRNNumber = async function () {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `GRN-${year}-${month}-${day}-`;

  // Find the latest GRN for today (excluding deleted)
  // Use regex to match GRN numbers starting with today's date prefix
  const latestGRN = await this.findOne({
    grnNumber: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), // Escape special regex chars
    isDeleted: false, // Exclude deleted GRNs
  })
    .sort({ createdAt: -1 }) // Sort by creation date instead of grnNumber string
    .select("grnNumber");

  let sequence = 1;
  if (latestGRN && latestGRN.grnNumber) {
    // Extract sequence number from format: GRN-YYYY-MM-DD-NNNNNN
    const parts = latestGRN.grnNumber.split("-");
    if (parts.length === 5) {
      // Format: ["GRN", "YYYY", "MM", "DD", "NNNNNN"]
      const latestSequence = parseInt(parts[4], 10);
      if (!isNaN(latestSequence)) {
        sequence = latestSequence + 1;
      }
    }
  }

  // Format: GRN-YYYY-MM-DD-NNNNNN (e.g., GRN-2024-01-14-000001)
  return `${prefix}${sequence.toString().padStart(6, "0")}`;
};

// Static method to drop the unique index on purchasingId (one-time migration)
// Call this once to remove the old unique constraint that prevents multiple GRNs per PO
goodsRecievedNoteSchema.statics.dropPurchasingIdUniqueIndex =
  async function () {
    try {
      const collection = this.collection;
      const indexes = await collection.indexes();

      // Find and drop the unique index on purchasingId if it exists
      const uniqueIndex = indexes.find(
        (index) =>
          index.key && index.key.purchasingId === 1 && index.unique === true
      );

      if (uniqueIndex) {
        await collection.dropIndex(uniqueIndex.name);
        console.log(
          `Dropped unique index on purchasingId: ${uniqueIndex.name}`
        );
        return true;
      } else {
        console.log(
          "No unique index on purchasingId found. Index may have already been dropped."
        );
        return false;
      }
    } catch (error) {
      // Index might not exist, which is fine
      if (error.code === 27 || error.codeName === "IndexNotFound") {
        console.log(
          "Unique index on purchasingId does not exist (already removed)."
        );
        return false;
      }
      throw error;
    }
  };

// Note: Warehouse stock updates are now handled by Transfer records
// This method is deprecated - use Transfer model to update warehouse stock
// GRN no longer has warehouseId field - all warehouse allocation is done via Transfer records

const GoodsRecievedNote = mongoose.model(
  "GoodsRecievedNote",
  goodsRecievedNoteSchema
);

export default GoodsRecievedNote;
