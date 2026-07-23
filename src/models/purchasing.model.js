import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
    },
    productStatus: {
      type: String,
      enum: ["pending", "seperated"],
      default: "pending",
    },
    productName: {
      type: String,
      required: true,
    },
    buyingPrice: {
      type: Number,
      required: true,
    },
    purchaseQuantity: {
      type: Number,
      required: true,
      // Original order quantity - never modified, preserved for record keeping
    },
    receivedQuantity: {
      type: Number,
      default: 0,
      min: [0, "Received quantity cannot be negative"],
      // Tracks total received quantity from all GRNs
      // remainingQuantity = purchaseQuantity - receivedQuantity
    },
    productCode: {
      type: String,
      required: true,
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

// Virtual for remaining quantity (purchaseQuantity - receivedQuantity)
productSchema.virtual("remainingQuantity").get(function () {
  const purchaseQty = this.purchaseQuantity || 0;
  const receivedQty = this.receivedQuantity || 0;
  return Math.max(0, purchaseQty - receivedQty);
});

const PurchasingSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: [true, "PO number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierProfile",
      required: true,
    },
    products: [productSchema],
    status: {
      type: String,
      enum: ["pending", "confirmed", "arrived", "cancelled", "completed"],
      default: "pending",
    },
    note: {
      type: String,
      trim: true,
      default: "No note available",
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    purchasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Purchased by is required"],
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

// Static method to generate PO number
// Format: PO-YYYY-MM-DD-NNNNNN (e.g., PO-2024-01-14-000001)
PurchasingSchema.statics.generatePONumber = async function () {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `PO-${year}-${month}-${day}-`;

  // Find the latest PO for today
  // Use regex to match PO numbers starting with today's date prefix
  const latestPO = await this.findOne({
    poNumber: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), // Escape special regex chars
  })
    .sort({ createdAt: -1 }) // Sort by creation date instead of poNumber string
    .select("poNumber");

  let sequence = 1;
  if (latestPO && latestPO.poNumber) {
    // Extract sequence number from format: PO-YYYY-MM-DD-NNNNNN
    const parts = latestPO.poNumber.split("-");
    if (parts.length === 5) {
      // Format: ["PO", "YYYY", "MM", "DD", "NNNNNN"]
      const latestSequence = parseInt(parts[4], 10);
      if (!isNaN(latestSequence)) {
        sequence = latestSequence + 1;
      }
    }
  }

  // Format: PO-YYYY-MM-DD-NNNNNN (e.g., PO-2024-01-14-000001)
  return `${prefix}${sequence.toString().padStart(6, "0")}`;
};

// Indexes for better query performance
// Note: poNumber already has an index from unique: true, so we don't need to index it again
PurchasingSchema.index({ status: 1 });
PurchasingSchema.index({ supplierId: 1 });
PurchasingSchema.index({ createdAt: -1 });
PurchasingSchema.index({ isDeleted: 1 });
PurchasingSchema.index({ status: 1, isDeleted: 1 }); // Compound index for common queries

const Purchasing = mongoose.model("Purchasing", PurchasingSchema);

export default Purchasing;
