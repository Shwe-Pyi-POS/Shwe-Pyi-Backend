import mongoose from "mongoose";

const quotationProductSchema = new mongoose.Schema({
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
    required: [true, "Inventory ID is required"],
  },
  productName: { type: String, default: null },
  productCode: { type: String, default: null },
  unit: { type: String, default: null, trim: true },
  factor: { type: Number, default: 1, min: 0.001 },
  quantity: { type: Number, required: [true, "Quantity is required"], min: 1 },
  baseQuantity: { type: Number, default: null },
  unitPrice: { type: Number, required: [true, "Unit price is required"], min: 0 },
}, { _id: false });

const quotationSchema = new mongoose.Schema({
  quotationNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
  },
  saleType: {
    type: String,
    enum: ["storefront", "direct-sale"],
    default: "storefront",
  },
  storefrontId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LocationProfile",
    default: null,
  },
  customerName: { type: String, trim: true, default: null },
  customerPhone: { type: String, trim: true, default: null },
  note: { type: String, trim: true, default: null },
  products: { type: [quotationProductSchema], default: [] },
  subTotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  finalAmount: { type: Number, required: [true, "Final amount is required"] },
  status: {
    type: String,
    enum: ["draft", "converted", "cancelled"],
    default: "draft",
  },
  convertedOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: [true, "Created by is required"],
  },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

quotationSchema.index({ status: 1 });
quotationSchema.index({ saleType: 1 });
quotationSchema.index({ createdAt: -1 });
quotationSchema.index({ isDeleted: 1, status: 1 });

quotationSchema.statics.generateQuotationNumber = async function () {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `QT-${y}${m}${d}-`;

  const last = await this.findOne({ quotationNumber: { $regex: `^${prefix}` } })
    .sort({ quotationNumber: -1 })
    .select("quotationNumber")
    .lean();

  let seq = 1;
  if (last) {
    const lastSeq = parseInt(last.quotationNumber.slice(-6), 10);
    seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(6, "0")}`;
};

const Quotation = mongoose.model("Quotation", quotationSchema);
export default Quotation;
