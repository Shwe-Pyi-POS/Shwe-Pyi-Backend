import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
    required: [true, "Inventory ID is required"],
  },
  productName: { type: String, required: true },
  productCode: { type: String },
  unit: { type: String, default: null },
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity must be at least 1"],
  },
  unitPrice: {
    type: Number,
    required: [true, "Unit price is required"],
    min: [0, "Unit price cannot be negative"],
  },
  subtotal: {
    type: Number,
    required: [true, "Subtotal is required"],
    min: [0, "Subtotal cannot be negative"],
  },
});

const ecommerceOrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: [true, "Customer ID is required"],
  },
  products: [productSchema],
  shippingAddress: {
    label: { type: String, trim: true },
    addressLine: { type: String, trim: true },
    city: { type: String, trim: true },
  },
  totalAmount: {
    type: Number,
    required: [true, "Total amount is required"],
    min: [0, "Total amount cannot be negative"],
  },
  status: {
    type: String,
    enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
    default: "pending",
  },
  paymentMethod: {
    type: String,
    default: "cash_on_delivery",
  },
  paymentStatus: {
    type: String,
    enum: ["unpaid", "paid"],
    default: "unpaid",
  },
  note: {
    type: String,
    trim: true,
    default: null,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

ecommerceOrderSchema.pre("save", async function () {
  if (this.isNew) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const prefix = `ECO-${year}-${month}-${day}-`;

    const lastOrder = await mongoose.model("EcommerceOrder").findOne({
      orderNumber: new RegExp(`^${prefix}`),
    }).sort({ orderNumber: -1 }).select("orderNumber");

    let seq = 1;
    if (lastOrder?.orderNumber) {
      const parts = lastOrder.orderNumber.split("-");
      if (parts.length === 5) {
        seq = parseInt(parts[4], 10) + 1;
      }
    }
    this.orderNumber = `${prefix}${String(seq).padStart(6, "0")}`;
  }
});

ecommerceOrderSchema.index({ customerId: 1, createdAt: -1 });
ecommerceOrderSchema.index({ orderNumber: 1 });

const EcommerceOrder = mongoose.model("EcommerceOrder", ecommerceOrderSchema);
export default EcommerceOrder;
