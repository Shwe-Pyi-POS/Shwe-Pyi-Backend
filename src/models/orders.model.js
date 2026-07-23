import mongoose from "mongoose";

const orderProductsSchema = new mongoose.Schema({
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
    required: [true, "Inventory ID is required"],
  },
  unit: {
    type: String,
    default: null,
    trim: true,
  },
  factor: {
    type: Number,
    default: 1,
    min: [0.001, "Factor must be greater than 0"],
  },
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity must be at least 1"],
  },
  baseQuantity: {
    type: Number,
    min: [0, "Base quantity cannot be negative"],
    default: null,
  },
  unitPrice: {
    type: Number,
    required: [true, "Unit price is required"],
    min: [0, "Unit price cannot be negative"],
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      sparse: true, // Allows null values during creation before orderNumber is assigned
      trim: true,
      uppercase: true,
    },
    saleType: {
      type: String,
      enum: {
        values: ["storefront", "direct-sale"],
        message: "Sale type must be storefront or direct-sale",
      },
      default: "storefront",
    },
    customerName: {
      type: String,
      trim: true,
      default: null,
    },
    customerPhone: {
      type: String,
      trim: true,
      default: null,
    },
    customerAddress: {
      type: String,
      trim: true,
      default: null,
    },
    storefrontId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      default: null,
    },
    ordersProducts: {
      type: [orderProductsSchema],
      default: [],
    },
    creditPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CreditPerson",
      default: null,
    },
    subTotal: {
      type: Number,
      default: null,
      min: [0, "Subtotal cannot be negative"],
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, "Tax cannot be negative"],
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, "Discount cannot be negative"],
    },
    transportFee: {
      type: Number,
      default: 0,
      min: [0, "Transport fee cannot be negative"],
    },
    finalAmount: {
      type: Number,
      required: [true, "Final amount is required"],
      min: [0, "Final amount cannot be negative"],
    },
    paidAmount: {
      type: Number,
      required: [true, "Paid amount is required"],
      min: [0, "Paid amount cannot be negative"],
    },
    extraChange: {
      type: Number,
      default: 0,
      min: [0, "Extra change cannot be negative"],
    },
    lastPaymentDate: {
      type: Date,
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    orderStatus: {
      type: String,
      enum: {
        values: ["pending", "completed", "cancelled"],
        message: "Order status must be pending, completed, or cancelled",
      },
      default: "pending",
    },
    soldBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Sold by is required"],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    paymentType: {
      type: String,
      enum: ["credit", "paid"],
      default: "paid",
    },
    paymentMethod: {
      type: String,
      default: "cash",
    },
    note: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Pre-save middleware to calculate extraChange if paidAmount or finalAmount changed
orderSchema.pre("save", async function () {
  // Auto-calculate extraChange if paidAmount and finalAmount are both set
  // This ensures extraChange = paidAmount - finalAmount (when positive)
  if (
    this.paidAmount != null &&
    this.finalAmount != null &&
    (this.isModified("paidAmount") ||
      this.isModified("finalAmount") ||
      this.isNew)
  ) {
    this.extraChange = Math.max(0, this.paidAmount - this.finalAmount);
  }
});

// Virtual for total paid amount (initial + all credit records)
// Note: This requires CreditRecords to be populated or calculated separately
orderSchema.virtual("totalPaidAmount").get(async function () {
  // This virtual won't work with async in getter
  // Use instance method instead for async calculation
  return null;
});

// Instance method to calculate total paid amount (including CreditRecords)
// Note: order.paidAmount is now updated when credit payments are recorded,
// so this method returns order.paidAmount directly.
// This denormalizes the data for better query performance.
orderSchema.methods.calculateTotalPaidAmount = async function (session = null) {
  // Since order.paidAmount is updated when credit payments are recorded,
  // it already includes the initial payment + all credit record payments
  return this.paidAmount || 0;
};

// Instance method to calculate remaining balance accurately
orderSchema.methods.calculateRemainingBalance = async function () {
  const totalPaid = await this.calculateTotalPaidAmount();
  if (this.finalAmount == null) {
    return null;
  }
  return Math.max(0, this.finalAmount - totalPaid);
};

// Virtual for remaining balance (synchronous - only uses initial paidAmount)
// For accurate calculation with CreditRecords, use calculateRemainingBalance() method
orderSchema.virtual("remainingBalance").get(function () {
  if (this.finalAmount == null || this.paidAmount == null) {
    return null;
  }
  // Note: This only considers initial payment, not CreditRecords
  // Use calculateRemainingBalance() method for accurate calculation
  return Math.max(0, this.finalAmount - this.paidAmount);
});

// Static method to generate order number
// Format: ORD-YYYY-MM-DD-NNNNNN (e.g., ORD-2024-01-15-000001)
// This format supports up to 999,999 orders per day
// Accepts optional date parameter for manual order dates
orderSchema.statics.generateOrderNumber = async function (date = null) {
  const now = date ? new Date(date) : new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `ORD-${year}-${month}-${day}-`;

  // Find the latest order for this date (excluding deleted)
  const latestOrder = await this.findOne({
    orderNumber: new RegExp(`^ORD-${year}-${month}-${day}-`),
    isDeleted: false,
  })
    .sort({ orderNumber: -1 })
    .select("orderNumber");

  let sequence = 1;
  if (latestOrder && latestOrder.orderNumber) {
    // Extract sequence number from format: ORD-YYYY-MM-DD-NNNNNN
    const parts = latestOrder.orderNumber.split("-");
    if (parts.length === 5) {
      // Format: ["ORD", "YYYY", "MM", "DD", "NNNNNN"]
      const latestSequence = parseInt(parts[4], 10);
      if (!isNaN(latestSequence)) {
        sequence = latestSequence + 1;
      }
    }
  }

  // Validate sequence doesn't exceed daily limit
  if (sequence > 999999) {
    throw new Error(
      `Daily order limit reached. Maximum 999,999 orders per day allowed.`,
    );
  }

  // Format: ORD-YYYY-MM-DD-NNNNNN (e.g., ORD-2024-01-15-000001)
  return `${prefix}${sequence.toString().padStart(6, "0")}`;
};

// Indexes for better query performance
orderSchema.index({ storefrontId: 1 });
orderSchema.index({ isDeleted: 1 });
orderSchema.index({ createdAt: -1 }); // For recent orders
// Note: orderNumber index is automatically created by unique: true in schema
orderSchema.index({ storefrontId: 1, isDeleted: 1 }); // Compound index for common queries
orderSchema.index({ orderStatus: 1 }); // For status filtering
orderSchema.index({ creditPersonId: 1 }); // For credit person queries
orderSchema.index({ paymentType: 1 }); // For filtering by payment type
orderSchema.index({ creditPersonId: 1, paymentType: 1, isDeleted: 1, orderStatus: 1 }); // For credit limit aggregation

// Performance indexes for orderNumber queries (used in generateOrderNumber)
orderSchema.index({ orderNumber: 1, isDeleted: 1 }); // For finding latest order by date prefix
orderSchema.index({ orderNumber: 1, createdAt: -1 }); // For sorting by orderNumber and date

const Order = mongoose.model("Order", orderSchema);

export default Order;
