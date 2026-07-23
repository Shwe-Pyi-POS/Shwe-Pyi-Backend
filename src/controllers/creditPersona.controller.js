import CreditPerson from "../models/creditPersona.model.js";
import Order from "../models/orders.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";

export const createCreditPerson = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, address, creditLimit } = req.body;

  if (!name || !phone) {
    return next(new CustomError(400, "Name and phone are required"));
  }

  const creditPerson = await CreditPerson.create({ name, phone, address, creditLimit });
  res.status(201).json({
    success: true,
    message: "Credit person created successfully",
    data: creditPerson,
  });
});

export const getAllCreditPersons = asyncErrorHandler(async (req, res, next) => {
  const creditPersons = await CreditPerson.find();
  res.status(200).json({
    success: true,
    message: "Credit persons fetched successfully",
    data: creditPersons,
  });
});

export const getCreditPersonById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const creditPerson = await CreditPerson.findById(id);
  if (!creditPerson) {
    return next(new CustomError(404, "Credit person not found"));
  }

  const [result] = await Order.aggregate([
    { $match: {
      creditPersonId: creditPerson._id,
      paymentType: "credit",
      isDeleted: false,
      orderStatus: { $ne: "cancelled" },
    }},
    { $group: {
      _id: null,
      totalOutstanding: { $sum: { $subtract: ["$finalAmount", "$paidAmount"] } },
    }},
  ]);

  const outstanding = result ? result.totalOutstanding : 0;
  const data = creditPerson.toObject();
  data.remainingLimit = data.creditLimit != null
    ? Math.max(0, data.creditLimit - outstanding)
    : null;

  res.status(200).json({
    success: true,
    message: "Credit person fetched successfully",
    data,
  });
});

export const updateCreditPerson = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, phone, address, creditLimit } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid credit person ID format"));
  }
  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (phone !== undefined) updateFields.phone = phone;
  if (address !== undefined) updateFields.address = address;
  if (creditLimit !== undefined) updateFields.creditLimit = creditLimit;
  const creditPerson = await CreditPerson.findByIdAndUpdate(
    id,
    updateFields,
    { new: true }
  );
  if (!creditPerson) {
    return next(new CustomError(404, "Credit person not found"));
  }
  res.status(200).json({
    success: true,
    message: "Credit person updated successfully",
    data: creditPerson,
  });
});

export const getCreditPersonOrderSummary = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid credit person ID format"));
  }

  const creditPerson = await CreditPerson.findById(id);
  if (!creditPerson) {
    return next(new CustomError(404, "Credit person not found"));
  }

  const matchFilter = {
    creditPersonId: new mongoose.Types.ObjectId(id),
    isDeleted: false,
  };

  if (startDate || endDate) {
    matchFilter.createdAt = {};
    if (startDate) {
      const s = new Date(startDate);
      if (isNaN(s.getTime())) {
        return next(new CustomError(400, "Invalid startDate format. Use YYYY-MM-DD"));
      }
      matchFilter.createdAt.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      if (isNaN(e.getTime())) {
        return next(new CustomError(400, "Invalid endDate format. Use YYYY-MM-DD"));
      }
      e.setHours(23, 59, 59, 999);
      matchFilter.createdAt.$lte = e;
    }
  }

  const [stats] = await Order.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalFinalAmount: { $sum: "$finalAmount" },
        totalPaidAmount: { $sum: "$paidAmount" },
        creditOrders: { $sum: { $cond: [{ $eq: ["$paymentType", "credit"] }, 1, 0] } },
        paidOrders: { $sum: { $cond: [{ $eq: ["$paymentType", "paid"] }, 1, 0] } },
        storefrontOrders: { $sum: { $cond: [{ $eq: ["$saleType", "storefront"] }, 1, 0] } },
        storefrontFinalAmount: { $sum: { $cond: [{ $eq: ["$saleType", "storefront"] }, "$finalAmount", 0] } },
        storefrontPaidAmount: { $sum: { $cond: [{ $eq: ["$saleType", "storefront"] }, "$paidAmount", 0] } },
        directSaleOrders: { $sum: { $cond: [{ $eq: ["$saleType", "direct-sale"] }, 1, 0] } },
        directSaleFinalAmount: { $sum: { $cond: [{ $eq: ["$saleType", "direct-sale"] }, "$finalAmount", 0] } },
        directSalePaidAmount: { $sum: { $cond: [{ $eq: ["$saleType", "direct-sale"] }, "$paidAmount", 0] } },
      },
    },
  ]);

  const totalFinal = stats?.totalFinalAmount || 0;
  const totalPaid = stats?.totalPaidAmount || 0;
  const sfFinal = stats?.storefrontFinalAmount || 0;
  const sfPaid = stats?.storefrontPaidAmount || 0;
  const dsFinal = stats?.directSaleFinalAmount || 0;
  const dsPaid = stats?.directSalePaidAmount || 0;

  // Compute remainingLimit based on ALL outstanding (ignores date filter)
  const [totalOutstandingResult] = await Order.aggregate([
    { $match: {
      creditPersonId: new mongoose.Types.ObjectId(id),
      paymentType: "credit",
      isDeleted: false,
      orderStatus: { $ne: "cancelled" },
    }},
    { $group: {
      _id: null,
      totalOutstanding: { $sum: { $subtract: ["$finalAmount", "$paidAmount"] } },
    }},
  ]);

  const totalOutstandingAll = totalOutstandingResult?.totalOutstanding || 0;
  const remainingLimit = creditPerson.creditLimit != null
    ? Math.max(0, creditPerson.creditLimit - totalOutstandingAll)
    : null;

  res.status(200).json({
    success: true,
    data: {
      creditPerson: {
        _id: creditPerson._id,
        name: creditPerson.name,
        phone: creditPerson.phone,
        address: creditPerson.address,
        creditLimit: creditPerson.creditLimit,
        remainingLimit,
      },
      summary: {
        totalOrders: stats?.totalOrders || 0,
        totalFinalAmount: totalFinal,
        totalPaidAmount: totalPaid,
        totalOutstandingAmount: Math.max(0, totalFinal - totalPaid),
        creditOrders: stats?.creditOrders || 0,
        paidOrders: stats?.paidOrders || 0,
        storefront: {
          totalOrders: stats?.storefrontOrders || 0,
          totalFinalAmount: sfFinal,
          totalPaidAmount: sfPaid,
          totalOutstandingAmount: Math.max(0, sfFinal - sfPaid),
        },
        directSale: {
          totalOrders: stats?.directSaleOrders || 0,
          totalFinalAmount: dsFinal,
          totalPaidAmount: dsPaid,
          totalOutstandingAmount: Math.max(0, dsFinal - dsPaid),
        },
      },
    },
  });
});
