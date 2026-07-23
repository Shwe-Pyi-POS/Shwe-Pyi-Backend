import mongoose from "mongoose";
import Purchasing from "../models/purchasing.model.js";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

// Helper: build date + supplier + status filter
const buildFilter = (req, next) => {
  const { supplierId, status } = req.query;

  const filter = { isDeleted: false };

  if (supplierId) {
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return next(new CustomError(400, "Invalid supplier ID format"));
    }
    filter.supplierId = new mongoose.Types.ObjectId(supplierId);
  }

  if (status) {
    const validStatuses = ["pending", "confirmed", "arrived", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return next(new CustomError(400, `Invalid status. Allowed: ${validStatuses.join(", ")}`));
    }
    filter.status = status;
  }

  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  return filter;
};

// ============================================================
// 1. Overall PO Report — summary + status breakdown + details
// ============================================================
export const getPurchaseReport = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const filter = buildFilter(req, next);
  if (!filter) return; // error was sent

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  // Run summary + breakdown + paginated list in parallel
  const [aggregated, totalCount, purchases] = await Promise.all([
    // Summary & status breakdown
    Purchasing.aggregate([
      { $match: filter },
      {
        $facet: {
          poSummary: [
            { $group: { _id: null, totalPOs: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } },
          ],
          productSummary: [
            { $unwind: "$products" },
            {
              $group: {
                _id: null,
                totalProductsOrdered: { $sum: "$products.purchaseQuantity" },
                totalReceived: { $sum: "$products.receivedQuantity" },
              },
            },
          ],
          statusBreakdown: [
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ],
        },
      },
    ]),
    // Total count for pagination
    Purchasing.countDocuments(filter),
    // Paginated PO list
    Purchasing.find(filter)
      .populate("supplierId", "supplierName supplierCode contactNumber")
      .populate("purchasedBy", "name role")
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
  ]);

  // Merge summary results
  const poSum = aggregated[0]?.poSummary?.[0] || { totalPOs: 0, totalAmount: 0 };
  const prodSum = aggregated[0]?.productSummary?.[0] || { totalProductsOrdered: 0, totalReceived: 0 };
  const statusBreakdown = aggregated[0]?.statusBreakdown || [];
  const totalRemaining = Math.max(0, prodSum.totalProductsOrdered - prodSum.totalReceived);

  // Add remainingQuantity to each purchase's products
  const enrichedPurchases = purchases.map((po) => {
    const poObj = po.toObject({ virtuals: true });
    const totalRemainingQty = poObj.products.reduce((sum, p) => {
      const remaining = Math.max(0, (p.purchaseQuantity || 0) - (p.receivedQuantity || 0));
      return sum + remaining;
    }, 0);
    return { ...poObj, totalRemainingQuantity: totalRemainingQty };
  });

  // Build status object
  const statusObj = {};
  for (const s of statusBreakdown) {
    statusObj[s._id] = s.count;
  }

  res.status(200).json({
    success: true,
    message: "Purchase report fetched successfully",
    data: {
      dateRange: {
        startDate: req.query.startDate ? new Date(req.query.startDate) : null,
        endDate: req.query.endDate ? new Date(req.query.endDate) : null,
      },
      summary: {
        totalPOs: poSum.totalPOs,
        totalAmount: poSum.totalAmount,
        totalProductsOrdered: prodSum.totalProductsOrdered,
        totalReceived: prodSum.totalReceived,
        totalRemaining,
        statusBreakdown: statusObj,
      },
      purchases: enrichedPurchases,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
        totalItems: totalCount,
        itemsPerPage: limitNum,
      },
    },
  });
});

// ============================================================
// 2. Product-Level PO Report
// ============================================================
export const getPurchaseProductReport = asyncErrorHandler(async (req, res, next) => {
  const {
    supplierId,
    category,
    page = 1,
    limit = 10,
    sortBy = "totalOrdered",
    sortOrder = "desc",
  } = req.query;

  const filter = { isDeleted: false };

  if (supplierId) {
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return next(new CustomError(400, "Invalid supplier ID format"));
    }
    filter.supplierId = new mongoose.Types.ObjectId(supplierId);
  }

  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const pipeline = [
    { $match: filter },
    { $unwind: "$products" },
    {
      $group: {
        _id: "$products.inventoryId",
        totalOrdered: { $sum: "$products.purchaseQuantity" },
        totalReceived: { $sum: "$products.receivedQuantity" },
        totalAmount: { $sum: { $multiply: ["$products.purchaseQuantity", "$products.buyingPrice"] } },
        poCount: { $addToSet: "$_id" },
      },
    },
    {
      $addFields: {
        totalRemaining: { $max: [0, { $subtract: ["$totalOrdered", "$totalReceived"] }] },
        poCount: { $size: "$poCount" },
      },
    },
    {
      $lookup: {
        from: "inventories",
        localField: "_id",
        foreignField: "_id",
        as: "inventory",
      },
    },
    { $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true } },
    { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } },
  ];

  if (category) {
    pipeline.push({ $match: { "inventory.category": category } });
  }

  // Count total before pagination
  const countPipeline = [...pipeline, { $count: "total" }];
  const countResult = await Purchasing.aggregate(countPipeline);
  const totalItems = countResult[0]?.total || 0;

  pipeline.push({ $skip: (pageNum - 1) * limitNum });
  pipeline.push({ $limit: limitNum });

  pipeline.push({
    $project: {
      _id: 0,
      inventoryId: "$_id",
      productName: { $ifNull: ["$inventory.productName", "Unknown"] },
      productCode: { $ifNull: ["$inventory.productCode", "N/A"] },
      category: "$inventory.category",
      subCategory: "$inventory.subCategory",
      brand: "$inventory.brand",
      unitOfMeasure: "$inventory.unitOfMeasure",
      totalOrdered: 1,
      totalReceived: 1,
      totalRemaining: 1,
      totalAmount: 1,
      poCount: 1,
    },
  });

  const products = await Purchasing.aggregate(pipeline);

  // Totals across all products
  const totals = products.reduce(
    (acc, p) => {
      acc.totalOrdered += p.totalOrdered;
      acc.totalReceived += p.totalReceived;
      acc.totalRemaining += p.totalRemaining;
      acc.totalAmount += p.totalAmount;
      acc.uniqueProducts += 1;
      return acc;
    },
    { totalOrdered: 0, totalReceived: 0, totalRemaining: 0, totalAmount: 0, uniqueProducts: 0 },
  );

  res.status(200).json({
    success: true,
    message: "Purchase product report fetched successfully",
    data: {
      dateRange: {
        startDate: req.query.startDate ? new Date(req.query.startDate) : null,
        endDate: req.query.endDate ? new Date(req.query.endDate) : null,
      },
      totals,
      products,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalItems / limitNum) || 1,
        totalItems,
        itemsPerPage: limitNum,
      },
    },
  });
});

// ============================================================
// 3. Supplier-Level PO Report
// ============================================================
export const getPurchaseSupplierReport = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "totalAmount",
    sortOrder = "desc",
  } = req.query;

  const filter = { isDeleted: false };

  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const pipeline = [
    { $match: filter },
    { $unwind: "$products" },
    {
      $group: {
        _id: "$supplierId",
        totalPOs: { $addToSet: "$_id" },
        totalAmount: { $sum: "$totalAmount" },
        totalOrdered: { $sum: "$products.purchaseQuantity" },
        totalReceived: { $sum: "$products.receivedQuantity" },
        lastPODate: { $max: "$createdAt" },
      },
    },
    {
      $addFields: {
        totalPOs: { $size: "$totalPOs" },
        totalRemaining: { $max: [0, { $subtract: ["$totalOrdered", "$totalReceived"] }] },
      },
    },
    {
      $lookup: {
        from: "supplierprofiles",
        localField: "_id",
        foreignField: "_id",
        as: "supplier",
      },
    },
    { $unwind: { path: "$supplier", preserveNullAndEmptyArrays: true } },
    { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } },
  ];

  // Count total
  const countPipeline = [...pipeline, { $count: "total" }];
  const countResult = await Purchasing.aggregate(countPipeline);
  const totalItems = countResult[0]?.total || 0;

  pipeline.push({ $skip: (pageNum - 1) * limitNum });
  pipeline.push({ $limit: limitNum });

  pipeline.push({
    $project: {
      _id: 0,
      supplierId: "$_id",
      supplierName: { $ifNull: ["$supplier.supplierName", "Unknown"] },
      supplierCode: { $ifNull: ["$supplier.supplierCode", "N/A"] },
      contactNumber: { $ifNull: ["$supplier.contactNumber", null] },
      totalPOs: 1,
      totalAmount: 1,
      totalOrdered: 1,
      totalReceived: 1,
      totalRemaining: 1,
      lastPODate: 1,
    },
  });

  const suppliers = await Purchasing.aggregate(pipeline);

  // Grand totals
  const totals = suppliers.reduce(
    (acc, s) => {
      acc.totalSuppliers += 1;
      acc.totalPOs += s.totalPOs;
      acc.totalAmount += s.totalAmount;
      acc.totalOrdered += s.totalOrdered;
      acc.totalReceived += s.totalReceived;
      acc.totalRemaining += s.totalRemaining;
      return acc;
    },
    { totalSuppliers: 0, totalPOs: 0, totalAmount: 0, totalOrdered: 0, totalReceived: 0, totalRemaining: 0 },
  );

  res.status(200).json({
    success: true,
    message: "Purchase supplier report fetched successfully",
    data: {
      dateRange: {
        startDate: req.query.startDate ? new Date(req.query.startDate) : null,
        endDate: req.query.endDate ? new Date(req.query.endDate) : null,
      },
      totals,
      suppliers,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalItems / limitNum) || 1,
        totalItems,
        itemsPerPage: limitNum,
      },
    },
  });
});
