import mongoose from "mongoose";

const creditPersonSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
    },
    phone: {
      type: String,
    },
    address: {
      type: String,
      default: null,
      trim: true,
    },
    creditLimit: {
      type: Number,
      default: null,
      min: [0, "Credit limit cannot be negative"],
    },
    blacklist: {
      type: Boolean,
      default: false,
    },
    blacklistReason: {
      type: String,
      default: null,
    },
    blacklistDate: {
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

const CreditPerson = mongoose.model("CreditPerson", creditPersonSchema);

export default CreditPerson;
