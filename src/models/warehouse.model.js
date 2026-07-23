import mongoose from "mongoose";

const warehouseStockSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Product is required"],
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      required: [true, "Warehouse is required"],
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [0, "Quantity cannot be negative"],
      default: 0,
    },
    // Low stock alert flag (calculated based on Inventory reorderPoint)
    isLowStock: {
      type: Boolean,
      default: false,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound unique index: One stock record per product per warehouse
warehouseStockSchema.index(
  { inventoryId: 1, warehouseId: 1 },
  { unique: true }
);

// Indexes for better query performance
warehouseStockSchema.index({ warehouseId: 1 });
warehouseStockSchema.index({ inventoryId: 1 });
warehouseStockSchema.index({ warehouseId: 1, isLowStock: 1 }); // For low stock queries per warehouse
warehouseStockSchema.index({ quantity: 1 }); // For sorting by quantity

// Virtual for available quantity (same as quantity since we don't track reservations here)
warehouseStockSchema.virtual("availableQuantity").get(function () {
  return this.quantity;
});

// Static method to find or create stock record
warehouseStockSchema.statics.findOrCreateStock = async function (
  inventoryId,
  warehouseId
) {
  let stock = await this.findOne({ inventoryId, warehouseId });

  if (!stock) {
    stock = await this.create({
      inventoryId,
      warehouseId,
      quantity: 0,
    });
  }

  return stock;
};

// Instance method to add stock (for GRN/receiving)
warehouseStockSchema.methods.addStock = function (amount) {
  if (amount < 0) {
    throw new Error("Amount must be positive");
  }
  this.quantity += amount;
  this.lastUpdated = new Date();
  return this.save();
};

// Instance method to remove stock (for sales/adjustments)
warehouseStockSchema.methods.removeStock = function (amount) {
  if (amount < 0) {
    throw new Error("Amount must be positive");
  }
  if (this.quantity < amount) {
    throw new Error("Insufficient stock");
  }
  this.quantity -= amount;
  this.lastUpdated = new Date();
  return this.save();
};

const WarehouseStock = mongoose.model("WarehouseStock", warehouseStockSchema);
export default WarehouseStock;
