// Get sale report for a specific storefront or all storefronts
import mongoose from "mongoose";
import CustomError from "../utils/customError.js";
import LocationProfile from "../models/locationProfile.model.js";
import Order from "../models/orders.model.js";
import CreditRecord from "../models/creditRecord.model.js";
import CreditPerson from "../models/creditPersona.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

export const getSaleReportByStorefrontId = asyncErrorHandler(
  async (req, res, next) => {
    const { storefrontId, saleType, startDate, endDate } = req.query;

    let storefront = null;

    // If storefrontId is provided, validate and fetch storefront
    if (storefrontId) {
      // Validate storefrontId
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }

      // Validate storefront exists
      storefront = await LocationProfile.findOne({
        _id: storefrontId,
        type: "storefront",
        isDeleted: false,
      });

      if (!storefront) {
        return next(new CustomError(404, "Storefront not found"));
      }
    }

    // Build query filter
    const filter = {
      isDeleted: false,
      orderStatus: "completed", // Only include completed orders
    };

    // Add storefrontId filter only if provided
    if (storefrontId) {
      filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    // Add saleType filter if provided
    if (saleType !== undefined && saleType !== "") {
      const validSaleTypes = ["storefront", "direct-sale"];
      if (!validSaleTypes.includes(saleType)) {
        return next(
          new CustomError(
            400,
            `Invalid sale type. Allowed values: ${validSaleTypes.join(", ")}`,
          ),
        );
      }
      filter.saleType = saleType;
    }

    // Add date range filter using dateFilter utility
    let parsedStartDate = null;
    let parsedEndDate = null;
    try {
      const dateFilter = createDateFilter(req.query, "createdAt", false);
      Object.assign(filter, dateFilter);

      // Extract parsed dates from the filter for response
      if (dateFilter.createdAt) {
        if (dateFilter.createdAt.$gte) {
          parsedStartDate = dateFilter.createdAt.$gte;
        }
        if (dateFilter.createdAt.$lte) {
          parsedEndDate = dateFilter.createdAt.$lte;
        }
      }
    } catch (error) {
      // If it's a CustomError, pass it to error handler
      if (error instanceof CustomError) {
        return next(error);
      }
      // For other errors, wrap and pass
      return next(new CustomError(400, error.message || "Invalid date filter"));
    }

    // Aggregate sale data
    const saleReport = await Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalFinalAmount: { $sum: "$finalAmount" },
          totalPaidAmount: { $sum: "$paidAmount" },
          totalSubTotal: { $sum: "$subTotal" },
          totalTax: { $sum: "$tax" },
          totalDiscount: { $sum: "$discount" },
          totalTransportFee: { $sum: "$transportFee" },
          totalExtraChange: { $sum: "$extraChange" },
          orderCount: { $sum: 1 },
          creditOrderCount: {
            $sum: { $cond: [{ $eq: ["$paymentType", "credit"] }, 1, 0] },
          },
          paidOrderCount: {
            $sum: { $cond: [{ $eq: ["$paymentType", "paid"] }, 1, 0] },
          },
        },
      },
    ]);

    // If no orders found, return zero values
    const report = saleReport[0] || {
      totalFinalAmount: 0,
      totalPaidAmount: 0,
      totalSubTotal: 0,
      totalTax: 0,
      totalDiscount: 0,
      totalTransportFee: 0,
      totalExtraChange: 0,
      orderCount: 0,
      creditOrderCount: 0,
      paidOrderCount: 0,
    };

    // Get date range info - use parsed dates from filter if available, otherwise use query params
    const dateRange = {
      startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
      endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
    };

    res.status(200).json({
      success: true,
      message: "Sale report fetched successfully",
      data: {
        storefront: storefront
          ? {
              _id: storefront._id,
              locationName: storefront.locationName,
              locationCode: storefront.locationCode,
            }
          : null,
        dateRange,
        report: {
          finalAmount: report.totalFinalAmount, // Main metric as requested
          paidAmount: report.totalPaidAmount,
          subTotal: report.totalSubTotal,
          tax: report.totalTax,
          discount: report.totalDiscount,
          transportFee: report.totalTransportFee,
          extraChange: report.totalExtraChange,
          orderCount: report.orderCount,
          creditOrderCount: report.creditOrderCount,
          paidOrderCount: report.paidOrderCount,
        },
      },
    });
  }
);

// Get payment method breakdown report for a specific storefront or all storefronts (paid orders only)
export const getPaymentMethodReportByStorefrontId = asyncErrorHandler(
  async (req, res, next) => {
    const { storefrontId, saleType } = req.query;

    let storefront = null;

    // If storefrontId is provided, validate and fetch storefront
    if (storefrontId) {
      // Validate storefrontId
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }

      // Validate storefront exists
      storefront = await LocationProfile.findOne({
        _id: storefrontId,
        type: "storefront",
        isDeleted: false,
      });

      if (!storefront) {
        return next(new CustomError(404, "Storefront not found"));
      }
    }

    // Build query filter - only paid orders
    const filter = {
      isDeleted: false,
      orderStatus: "completed", // Only include completed orders
      paymentType: "paid", // Only paid orders
    };

    // Add storefrontId filter only if provided
    if (storefrontId) {
      filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    // Add saleType filter if provided
    if (saleType !== undefined && saleType !== "") {
      const validSaleTypes = ["storefront", "direct-sale"];
      if (!validSaleTypes.includes(saleType)) {
        return next(
          new CustomError(
            400,
            `Invalid sale type. Allowed values: ${validSaleTypes.join(", ")}`,
          ),
        );
      }
      filter.saleType = saleType;
    }

    // Add date range filter using dateFilter utility
    let parsedStartDate = null;
    let parsedEndDate = null;
    try {
      const dateFilter = createDateFilter(req.query, "createdAt", false);
      Object.assign(filter, dateFilter);

      // Extract parsed dates from the filter for response
      if (dateFilter.createdAt) {
        if (dateFilter.createdAt.$gte) {
          parsedStartDate = dateFilter.createdAt.$gte;
        }
        if (dateFilter.createdAt.$lte) {
          parsedEndDate = dateFilter.createdAt.$lte;
        }
      }
    } catch (error) {
      // If it's a CustomError, pass it to error handler
      if (error instanceof CustomError) {
        return next(error);
      }
      // For other errors, wrap and pass
      return next(new CustomError(400, error.message || "Invalid date filter"));
    }

    // Aggregate payment method breakdown
    const paymentMethodReport = await Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$paymentMethod", // Group by payment method
          totalPaidAmount: { $sum: "$paidAmount" },
          orderCount: { $sum: 1 },
          totalFinalAmount: { $sum: "$finalAmount" },
        },
      },
      {
        $sort: { totalPaidAmount: -1 }, // Sort by total paid amount descending
      },
    ]);

    // Calculate totals across all payment methods
    const totals = paymentMethodReport.reduce(
      (acc, item) => {
        acc.totalPaidAmount += item.totalPaidAmount;
        acc.totalFinalAmount += item.totalFinalAmount;
        acc.totalOrderCount += item.orderCount;
        return acc;
      },
      {
        totalPaidAmount: 0,
        totalFinalAmount: 0,
        totalOrderCount: 0,
      }
    );

    // Get date range info
    const { startDate, endDate } = req.query;
    const dateRange = {
      startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
      endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
    };

    res.status(200).json({
      success: true,
      message: "Payment method report fetched successfully",
      data: {
        storefront: storefront
          ? {
              _id: storefront._id,
              locationName: storefront.locationName,
              locationCode: storefront.locationCode,
            }
          : null,
        dateRange,
        totals: {
          totalPaidAmount: totals.totalPaidAmount,
          totalFinalAmount: totals.totalFinalAmount,
          totalOrderCount: totals.totalOrderCount,
        },
        paymentMethods: paymentMethodReport.map((item) => ({
          paymentMethod: item._id || "unknown",
          totalPaidAmount: item.totalPaidAmount,
          totalFinalAmount: item.totalFinalAmount,
          orderCount: item.orderCount,
        })),
      },
    });
  }
);

// Get credit sale report with credit records breakdown for a specific storefront or all storefronts
// export const getCreditSaleReportByStorefrontId = asyncErrorHandler(
//   async (req, res, next) => {
//     const { storefrontId } = req.query;

//     let storefront = null;

//     // If storefrontId is provided, validate and fetch storefront
//     if (storefrontId) {
//       // Validate storefrontId
//       if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
//         return next(new CustomError(400, "Invalid storefront ID format"));
//       }

//       // Validate storefront exists
//       storefront = await LocationProfile.findOne({
//         _id: storefrontId,
//         type: "storefront",
//         isDeleted: false,
//       });

//       if (!storefront) {
//         return next(new CustomError(404, "Storefront not found"));
//       }
//     }

//     // Build query filter - only credit orders
//     const filter = {
//       isDeleted: false,
//       orderStatus: "completed", // Only include completed orders
//       paymentType: "credit", // Only credit orders
//     };

//     // Add storefrontId filter only if provided
//     if (storefrontId) {
//       filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
//     }

//     // Add date range filter using dateFilter utility
//     let parsedStartDate = null;
//     let parsedEndDate = null;
//     try {
//       const dateFilter = createDateFilter(req.query, "paymentDate", false);
//       Object.assign(filter, dateFilter);

//       // Extract parsed dates from the filter for response
//       if (dateFilter.paymentDate) {
//         if (dateFilter.paymentDate.$gte) {
//           parsedStartDate = dateFilter.paymentDate.$gte;
//         }
//         if (dateFilter.paymentDate.$lte) {
//           parsedEndDate = dateFilter.paymentDate.$lte;
//         }
//       }
//     } catch (error) {
//       // If it's a CustomError, pass it to error handler
//       if (error instanceof CustomError) {
//         return next(error);
//       }
//       // For other errors, wrap and pass
//       return next(new CustomError(400, error.message || "Invalid date filter"));
//     }

//     // Get all credit orders
//     const creditOrders = await Order.find(filter).select(
//       "_id orderNumber finalAmount paidAmount paymentMethod createdAt"
//     );

//     const orderIds = creditOrders.map((order) => order._id);

//     // Get all credit records for these orders
//     const creditRecords = await CreditRecord.find({
//       orderId: { $in: orderIds },
//       isDeleted: false,
//     }).select("orderId paidAmount paymentMethod paymentDate");

//     // Create a map of orderId to credit records
//     const creditRecordsByOrder = {};
//     creditRecords.forEach((record) => {
//       const orderIdStr = record.orderId.toString();
//       if (!creditRecordsByOrder[orderIdStr]) {
//         creditRecordsByOrder[orderIdStr] = [];
//       }
//       creditRecordsByOrder[orderIdStr].push(record);
//     });

//     // Calculate initial payments and group by payment method
//     const initialPaymentByMethod = {};
//     const creditPaymentByMethod = {};
//     let totalFinalAmount = 0;
//     let totalPaidAmount = 0;
//     let totalInitialPaidAmount = 0;
//     let totalCreditPaidAmount = 0;
//     let totalRemainingBalance = 0;
//     let orderCount = 0;

//     creditOrders.forEach((order) => {
//       const orderIdStr = order._id.toString();
//       const creditRecordsForOrder = creditRecordsByOrder[orderIdStr] || [];

//       // Calculate total from credit records
//       const totalCreditPaidForOrder = creditRecordsForOrder.reduce(
//         (sum, record) => sum + (record.paidAmount || 0),
//         0
//       );

//       // Calculate initial paid amount: order.paidAmount - total from credit records
//       // Note: order.paidAmount includes initial + all credit payments (denormalized)
//       const initialPaidAmount = Math.max(
//         0,
//         (order.paidAmount || 0) - totalCreditPaidForOrder
//       );

//       // Get initial payment method from order
//       const initialPaymentMethod = order.paymentMethod || "cash";

//       // Aggregate initial payments by payment method
//       if (!initialPaymentByMethod[initialPaymentMethod]) {
//         initialPaymentByMethod[initialPaymentMethod] = {
//           paymentMethod: initialPaymentMethod,
//           totalPaidAmount: 0,
//           orderCount: 0,
//         };
//       }
//       initialPaymentByMethod[initialPaymentMethod].totalPaidAmount +=
//         initialPaidAmount;
//       if (initialPaidAmount > 0) {
//         initialPaymentByMethod[initialPaymentMethod].orderCount += 1;
//       }

//       // Aggregate credit record payments by payment method
//       creditRecordsForOrder.forEach((record) => {
//         const paymentMethod = record.paymentMethod || "cash";
//         if (!creditPaymentByMethod[paymentMethod]) {
//           creditPaymentByMethod[paymentMethod] = {
//             paymentMethod: paymentMethod,
//             totalPaidAmount: 0,
//             recordCount: 0,
//           };
//         }
//         creditPaymentByMethod[paymentMethod].totalPaidAmount +=
//           record.paidAmount || 0;
//         creditPaymentByMethod[paymentMethod].recordCount += 1;
//       });

//       // Aggregate totals
//       totalFinalAmount += order.finalAmount || 0;
//       totalPaidAmount += order.paidAmount || 0;
//       totalInitialPaidAmount += initialPaidAmount;
//       totalCreditPaidAmount += totalCreditPaidForOrder;
//       totalRemainingBalance += Math.max(
//         0,
//         (order.finalAmount || 0) - (order.paidAmount || 0)
//       );
//       orderCount += 1;
//     });

//     // Convert to arrays and sort
//     const initialPayments = Object.values(initialPaymentByMethod)
//       .filter((item) => item.totalPaidAmount > 0)
//       .sort((a, b) => b.totalPaidAmount - a.totalPaidAmount);

//     const creditPayments = Object.values(creditPaymentByMethod)
//       .filter((item) => item.totalPaidAmount > 0)
//       .sort((a, b) => b.totalPaidAmount - a.totalPaidAmount);

//     // Get date range info
//     const { startDate, endDate } = req.query;
//     const dateRange = {
//       startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
//       endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
//     };

//     res.status(200).json({
//       success: true,
//       message: "Credit sale report fetched successfully",
//       data: {
//         storefront: storefront
//           ? {
//               _id: storefront._id,
//               locationName: storefront.locationName,
//               locationCode: storefront.locationCode,
//             }
//           : null,
//         dateRange,
//         totals: {
//           totalFinalAmount,
//           totalPaidAmount,
//           totalInitialPaidAmount,
//           totalCreditPaidAmount,
//           totalRemainingBalance,
//           orderCount,
//           creditRecordCount: creditRecords.length,
//         },
//         initialPayments: initialPayments,
//         creditPayments: creditPayments,
//       },
//     });
//   }
// );

export const getCreditSaleReportByStorefrontId = asyncErrorHandler(
  async (req, res, next) => {
    const { storefrontId, saleType } = req.query;

    let storefront = null;

    // If storefrontId is provided, validate and fetch storefront
    if (storefrontId) {
      // Validate storefrontId
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }

      // Validate storefront exists
      storefront = await LocationProfile.findOne({
        _id: storefrontId,
        type: "storefront",
        isDeleted: false,
      });

      if (!storefront) {
        return next(new CustomError(404, "Storefront not found"));
      }
    }

    // Build query filter - only credit orders
    const filter = {
      isDeleted: false,
      orderStatus: "completed", // Only include completed orders
      paymentType: "credit", // Only credit orders
    };

    // Add saleType filter if provided
    if (saleType !== undefined && saleType !== "") {
      const validSaleTypes = ["storefront", "direct-sale"];
      if (!validSaleTypes.includes(saleType)) {
        return next(
          new CustomError(
            400,
            `Invalid sale type. Allowed values: ${validSaleTypes.join(", ")}`,
          ),
        );
      }
      filter.saleType = saleType;
    }

    // Add storefrontId filter only if provided
    if (storefrontId) {
      filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    // Add date range filter using dateFilter utility
    let parsedStartDate = null;
    let parsedEndDate = null;
    try {
      const dateFilter = createDateFilter(req.query, "createdAt", false);
      Object.assign(filter, dateFilter);

      // Extract parsed dates from the filter for response
      if (dateFilter.createdAt) {
        if (dateFilter.createdAt.$gte) {
          parsedStartDate = dateFilter.createdAt.$gte;
        }
        if (dateFilter.createdAt.$lte) {
          parsedEndDate = dateFilter.createdAt.$lte;
        }
      }
    } catch (error) {
      // If it's a CustomError, pass it to error handler
      if (error instanceof CustomError) {
        return next(error);
      }
      // For other errors, wrap and pass
      return next(new CustomError(400, error.message || "Invalid date filter"));
    }

    // Get all credit orders
    const creditOrders = await Order.find(filter).select(
      "_id orderNumber finalAmount paidAmount paymentMethod createdAt"
    );

    const orderIds = creditOrders.map((order) => order._id);

    // Get all credit records for these orders
    const creditRecords = await CreditRecord.find({
      orderId: { $in: orderIds },
      isDeleted: false,
    }).select("orderId paidAmount paymentMethod paymentDate");

    // Create a map of orderId to credit records
    const creditRecordsByOrder = {};
    creditRecords.forEach((record) => {
      const orderIdStr = record.orderId.toString();
      if (!creditRecordsByOrder[orderIdStr]) {
        creditRecordsByOrder[orderIdStr] = [];
      }
      creditRecordsByOrder[orderIdStr].push(record);
    });

    // Calculate initial payments and group by payment method
    const initialPaymentByMethod = {};
    const creditPaymentByMethod = {};
    let totalFinalAmount = 0;
    let totalPaidAmount = 0;
    let totalInitialPaidAmount = 0;
    let totalCreditPaidAmount = 0;
    let totalRemainingBalance = 0;
    let orderCount = 0;

    creditOrders.forEach((order) => {
      const orderIdStr = order._id.toString();
      const creditRecordsForOrder = creditRecordsByOrder[orderIdStr] || [];

      // Calculate total from credit records
      const totalCreditPaidForOrder = creditRecordsForOrder.reduce(
        (sum, record) => sum + (record.paidAmount || 0),
        0
      );

      // Calculate initial paid amount: order.paidAmount - total from credit records
      // Note: order.paidAmount includes initial + all credit payments (denormalized)
      const initialPaidAmount = Math.max(
        0,
        (order.paidAmount || 0) - totalCreditPaidForOrder
      );

      // Get initial payment method from order
      const initialPaymentMethod = order.paymentMethod || "cash";

      // Aggregate initial payments by payment method
      if (!initialPaymentByMethod[initialPaymentMethod]) {
        initialPaymentByMethod[initialPaymentMethod] = {
          paymentMethod: initialPaymentMethod,
          totalPaidAmount: 0,
          orderCount: 0,
        };
      }
      initialPaymentByMethod[initialPaymentMethod].totalPaidAmount +=
        initialPaidAmount;
      if (initialPaidAmount > 0) {
        initialPaymentByMethod[initialPaymentMethod].orderCount += 1;
      }

      // Aggregate credit record payments by payment method
      creditRecordsForOrder.forEach((record) => {
        const paymentMethod = record.paymentMethod || "cash";
        if (!creditPaymentByMethod[paymentMethod]) {
          creditPaymentByMethod[paymentMethod] = {
            paymentMethod: paymentMethod,
            totalPaidAmount: 0,
            recordCount: 0,
          };
        }
        creditPaymentByMethod[paymentMethod].totalPaidAmount +=
          record.paidAmount || 0;
        creditPaymentByMethod[paymentMethod].recordCount += 1;
      });

      // Aggregate totals
      totalFinalAmount += order.finalAmount || 0;
      totalPaidAmount += order.paidAmount || 0;
      totalInitialPaidAmount += initialPaidAmount;
      totalCreditPaidAmount += totalCreditPaidForOrder;
      totalRemainingBalance += Math.max(
        0,
        (order.finalAmount || 0) - (order.paidAmount || 0)
      );
      orderCount += 1;
    });

    // Convert to arrays and sort
    const initialPayments = Object.values(initialPaymentByMethod)
      .filter((item) => item.totalPaidAmount > 0)
      .sort((a, b) => b.totalPaidAmount - a.totalPaidAmount);

    const creditPayments = Object.values(creditPaymentByMethod)
      .filter((item) => item.totalPaidAmount > 0)
      .sort((a, b) => b.totalPaidAmount - a.totalPaidAmount);

    // Get date range info
    const { startDate, endDate } = req.query;
    const dateRange = {
      startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
      endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
    };

    res.status(200).json({
      success: true,
      message: "Credit sale report fetched successfully",
      data: {
        storefront: storefront
          ? {
              _id: storefront._id,
              locationName: storefront.locationName,
              locationCode: storefront.locationCode,
            }
          : null,
        dateRange,
        totals: {
          totalFinalAmount,
          totalPaidAmount,
          totalInitialPaidAmount,
          totalCreditPaidAmount,
          totalRemainingBalance,
          orderCount,
          creditRecordCount: creditRecords.length,
        },
        initialPayments: initialPayments,
        creditPayments: creditPayments,
      },
    });
  }
);

// Get product/stock sales statistics for a specific storefront or all storefronts
export const getProductSalesReportByStorefrontId = asyncErrorHandler(
  async (req, res, next) => {
    const { storefrontId, saleType } = req.query;

    let storefront = null;

    // If storefrontId is provided, validate and fetch storefront
    if (storefrontId) {
      // Validate storefrontId
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }

      // Validate storefront exists
      storefront = await LocationProfile.findOne({
        _id: storefrontId,
        type: "storefront",
        isDeleted: false,
      });

      if (!storefront) {
        return next(new CustomError(404, "Storefront not found"));
      }
    }

    // Build query filter
    const filter = {
      isDeleted: false,
      orderStatus: "completed", // Only include completed orders
    };

    // Add storefrontId filter only if provided
    if (storefrontId) {
      filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    // Add saleType filter if provided
    if (saleType !== undefined && saleType !== "") {
      const validSaleTypes = ["storefront", "direct-sale"];
      if (!validSaleTypes.includes(saleType)) {
        return next(
          new CustomError(
            400,
            `Invalid sale type. Allowed values: ${validSaleTypes.join(", ")}`,
          ),
        );
      }
      filter.saleType = saleType;
    }

    // Add date range filter using dateFilter utility
    let parsedStartDate = null;
    let parsedEndDate = null;
    try {
      const dateFilter = createDateFilter(req.query, "createdAt", false);
      Object.assign(filter, dateFilter);

      // Extract parsed dates from the filter for response
      if (dateFilter.createdAt) {
        if (dateFilter.createdAt.$gte) {
          parsedStartDate = dateFilter.createdAt.$gte;
        }
        if (dateFilter.createdAt.$lte) {
          parsedEndDate = dateFilter.createdAt.$lte;
        }
      }
    } catch (error) {
      // If it's a CustomError, pass it to error handler
      if (error instanceof CustomError) {
        return next(error);
      }
      // For other errors, wrap and pass
      return next(new CustomError(400, error.message || "Invalid date filter"));
    }

    // Aggregate product sales statistics
    const productSalesReport = await Order.aggregate([
      { $match: filter },
      // Unwind the ordersProducts array to get individual products
      { $unwind: "$ordersProducts" },
      // Add a baseQuantity field (use baseQuantity if available, fallback to quantity)
      {
        $addFields: {
          "ordersProducts.effectiveBaseQty": {
            $ifNull: ["$ordersProducts.baseQuantity", "$ordersProducts.quantity"],
          },
        },
      },
      // Group by inventoryId to aggregate statistics
      {
        $group: {
          _id: "$ordersProducts.inventoryId",
          totalQuantity: { $sum: "$ordersProducts.effectiveBaseQty" },
          totalRevenue: {
            $sum: {
              $multiply: [
                "$ordersProducts.quantity",
                "$ordersProducts.unitPrice",
              ],
            },
          },
          orderCount: { $addToSet: "$_id" }, // Count unique orders
          averageUnitPrice: { $avg: "$ordersProducts.unitPrice" },
          minUnitPrice: { $min: "$ordersProducts.unitPrice" },
          maxUnitPrice: { $max: "$ordersProducts.unitPrice" },
        },
      },
      // Calculate orderCount as array length
      {
        $addFields: {
          orderCount: { $size: "$orderCount" },
        },
      },
      // Sort by total quantity descending
      {
        $sort: { totalQuantity: -1 },
      },
      // Lookup inventory details
      {
        $lookup: {
          from: "inventories",
          localField: "_id",
          foreignField: "_id",
          as: "inventory",
        },
      },
      // Unwind inventory array (should be single item)
      {
        $unwind: {
          path: "$inventory",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Project final structure
      {
        $project: {
          _id: 0,
          inventoryId: "$_id",
          productName: "$inventory.productName",
          productCode: "$inventory.productCode",
          SKU: "$inventory.SKU",
          category: "$inventory.category",
          subCategory: "$inventory.subCategory",
          brand: "$inventory.brand",
          unitOfMeasure: "$inventory.unitOfMeasure",
          totalQuantity: 1,
          totalRevenue: 1,
          orderCount: 1,
          averageUnitPrice: { $round: ["$averageUnitPrice", 2] },
          minUnitPrice: 1,
          maxUnitPrice: 1,
        },
      },
    ]);

    // Calculate totals across all products
    const totals = productSalesReport.reduce(
      (acc, item) => {
        acc.totalQuantity += item.totalQuantity;
        acc.totalRevenue += item.totalRevenue;
        acc.totalUniqueProducts += 1;
        return acc;
      },
      {
        totalQuantity: 0,
        totalRevenue: 0,
        totalUniqueProducts: 0,
      }
    );

    // Get date range info
    const { startDate, endDate } = req.query;
    const dateRange = {
      startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
      endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
    };

    res.status(200).json({
      success: true,
      message: "Product sales report fetched successfully",
      data: {
        storefront: storefront
          ? {
              _id: storefront._id,
              locationName: storefront.locationName,
              locationCode: storefront.locationCode,
            }
          : null,
        dateRange,
        totals: {
          totalQuantity: totals.totalQuantity,
          totalRevenue: totals.totalRevenue,
          totalUniqueProducts: totals.totalUniqueProducts,
        },
        products: productSalesReport,
      },
    });
  }
);

// Get credit persona product report - shows what products a credit person bought and how much
export const getCreditPersonaProductReport = asyncErrorHandler(
  async (req, res, next) => {
    const { creditPersonaId, storefrontId, startDate, endDate } = req.query;

    // Validate creditPersonaId
    if (!creditPersonaId) {
      return next(new CustomError(400, "Credit persona ID is required"));
    }

    if (!mongoose.Types.ObjectId.isValid(creditPersonaId)) {
      return next(new CustomError(400, "Invalid credit persona ID format"));
    }

    // Validate credit persona exists
    const creditPersona = await CreditPerson.findOne({
      _id: creditPersonaId,
    });

    if (!creditPersona) {
      return next(new CustomError(404, "Credit persona not found"));
    }

    let storefront = null;

    // If storefrontId is provided, validate and fetch storefront
    if (storefrontId) {
      // Validate storefrontId
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }

      // Validate storefront exists
      storefront = await LocationProfile.findOne({
        _id: storefrontId,
        type: "storefront",
        isDeleted: false,
      });

      if (!storefront) {
        return next(new CustomError(404, "Storefront not found"));
      }
    }

    // Build query filter - only credit orders for this specific credit persona
    const filter = {
      isDeleted: false,
      orderStatus: "completed", // Only include completed orders
      paymentType: "credit", // Only credit orders
      creditPersonId: new mongoose.Types.ObjectId(creditPersonaId),
    };

    // Add storefrontId filter only if provided
    if (storefrontId) {
      filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    // Add date range filter using dateFilter utility
    let parsedStartDate = null;
    let parsedEndDate = null;
    try {
      const dateFilter = createDateFilter(req.query, "createdAt", false);
      Object.assign(filter, dateFilter);

      // Extract parsed dates from the filter for response
      if (dateFilter.createdAt) {
        if (dateFilter.createdAt.$gte) {
          parsedStartDate = dateFilter.createdAt.$gte;
        }
        if (dateFilter.createdAt.$lte) {
          parsedEndDate = dateFilter.createdAt.$lte;
        }
      }
    } catch (error) {
      // If it's a CustomError, pass it to error handler
      if (error instanceof CustomError) {
        return next(error);
      }
      // For other errors, wrap and pass
      return next(new CustomError(400, error.message || "Invalid date filter"));
    }

    // Aggregate product data for the credit persona
    const productReport = await Order.aggregate([
      { $match: filter },
      // Unwind the ordersProducts array to get individual products
      { $unwind: "$ordersProducts" },
      // Group by inventoryId to aggregate statistics
      {
        $group: {
          _id: "$ordersProducts.inventoryId",
          totalQuantity: { $sum: "$ordersProducts.quantity" },
          orderCount: { $addToSet: "$_id" }, // Count unique orders
          productName: { $first: "$ordersProducts.productName" }, // Get product name from order
          productCode: { $first: "$ordersProducts.productCode" }, // Get product code from order
          SKU: { $first: "$ordersProducts.SKU" }, // Get SKU from order
          unitOfMeasure: { $first: "$ordersProducts.unitOfMeasure" }, // Get unit of measure from order
        },
      },
      // Calculate orderCount as array length
      {
        $addFields: {
          orderCount: { $size: "$orderCount" },
        },
      },
      // Sort by total quantity descending
      {
        $sort: { totalQuantity: -1 },
      },
      // Lookup inventory details to get complete product information
      {
        $lookup: {
          from: "inventories",
          localField: "_id",
          foreignField: "_id",
          as: "inventory",
        },
      },
      // Unwind inventory array (should be single item)
      {
        $unwind: {
          path: "$inventory",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Project final structure - use inventory data if available, otherwise use order data
      {
        $project: {
          _id: 0,
          inventoryId: "$_id",
          productName: { $ifNull: ["$inventory.productName", "$productName"] },
          productCode: { $ifNull: ["$inventory.productCode", "$productCode"] },
          SKU: { $ifNull: ["$inventory.SKU", "$SKU"] },
          unitOfMeasure: {
            $ifNull: ["$inventory.unitOfMeasure", "$unitOfMeasure"],
          },
          totalQuantity: 1,
          orderCount: 1,
        },
      },
    ]);

    // Calculate totals across all products
    const totals = productReport.reduce(
      (acc, item) => {
        acc.totalQuantity += item.totalQuantity;
        acc.totalUniqueProducts += 1;
        acc.totalOrderCount += item.orderCount;
        return acc;
      },
      {
        totalQuantity: 0,
        totalUniqueProducts: 0,
        totalOrderCount: 0,
      }
    );

    // Get date range info
    const dateRange = {
      startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
      endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
    };

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Credit persona product report fetched successfully",
      data: {
        creditPersona: {
          id: creditPersona._id.toString(),
          name: creditPersona.name,
          phone: creditPersona.phone,
        },
        storefront: storefront
          ? {
              _id: storefront._id,
              locationName: storefront.locationName,
              locationCode: storefront.locationCode,
            }
          : null,
        dateRange,
        totals: {
          totalQuantity: totals.totalQuantity,
          totalUniqueProducts: totals.totalUniqueProducts,
          totalOrderCount: totals.totalOrderCount,
        },
        products: productReport,
      },
    });
  }
);

// Get sale products analytics by credit person - shows for each product, which credit persons bought it and their quantities
export const getSaleProductsAnalyticsByCreditPerson = asyncErrorHandler(
  async (req, res, next) => {
    const { storefrontId, startDate, endDate, inventoryId } = req.query;

    let storefront = null;

    // If storefrontId is provided, validate and fetch storefront
    if (storefrontId) {
      // Validate storefrontId
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }

      // Validate storefront exists
      storefront = await LocationProfile.findOne({
        _id: storefrontId,
        type: "storefront",
        isDeleted: false,
      });

      if (!storefront) {
        return next(new CustomError(404, "Storefront not found"));
      }
    }

    // Build query filter - only credit orders with credit persons
    const filter = {
      isDeleted: false,
      orderStatus: "completed", // Only include completed orders
      paymentType: "credit", // Only credit orders
      creditPersonId: { $exists: true, $ne: null }, // Only orders with credit persons
    };

    // Add storefrontId filter only if provided
    if (storefrontId) {
      filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    // Add inventoryId filter if provided
    if (inventoryId) {
      if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
        return next(new CustomError(400, "Invalid inventory ID format"));
      }
      filter["ordersProducts.inventoryId"] = new mongoose.Types.ObjectId(
        inventoryId
      );
    }

    // Add date range filter using dateFilter utility
    let parsedStartDate = null;
    let parsedEndDate = null;
    try {
      const dateFilter = createDateFilter(req.query, "createdAt", false);
      Object.assign(filter, dateFilter);

      // Extract parsed dates from the filter for response
      if (dateFilter.createdAt) {
        if (dateFilter.createdAt.$gte) {
          parsedStartDate = dateFilter.createdAt.$gte;
        }
        if (dateFilter.createdAt.$lte) {
          parsedEndDate = dateFilter.createdAt.$lte;
        }
      }
    } catch (error) {
      // If it's a CustomError, pass it to error handler
      if (error instanceof CustomError) {
        return next(error);
      }
      // For other errors, wrap and pass
      return next(new CustomError(400, error.message || "Invalid date filter"));
    }

    // Aggregate product data by credit person
    const productAnalytics = await Order.aggregate([
      { $match: filter },
      // Unwind the ordersProducts array to get individual products
      { $unwind: "$ordersProducts" },
      // Group by inventoryId and creditPersonId to get quantities per credit person
      {
        $group: {
          _id: {
            inventoryId: "$ordersProducts.inventoryId",
            creditPersonId: "$creditPersonId",
          },
          totalQuantity: { $sum: "$ordersProducts.quantity" },
          orderCount: { $addToSet: "$_id" }, // Count unique orders
          productName: { $first: "$ordersProducts.productName" }, // Get product name from order
          productCode: { $first: "$ordersProducts.productCode" }, // Get product code from order
          SKU: { $first: "$ordersProducts.SKU" }, // Get SKU from order
          unitOfMeasure: { $first: "$ordersProducts.unitOfMeasure" }, // Get unit of measure from order
        },
      },
      // Calculate orderCount as array length
      {
        $addFields: {
          orderCount: { $size: "$orderCount" },
        },
      },
      // Group by inventoryId to collect all credit persons for each product
      {
        $group: {
          _id: "$_id.inventoryId",
          creditPersons: {
            $push: {
              creditPersonId: "$_id.creditPersonId",
              totalQuantity: "$totalQuantity",
              orderCount: "$orderCount",
            },
          },
          totalQuantity: { $sum: "$totalQuantity" }, // Total quantity across all credit persons
          totalOrders: { $sum: "$orderCount" }, // Total orders across all credit persons
          uniqueCreditPersons: { $addToSet: "$_id.creditPersonId" }, // Count unique credit persons
          productName: { $first: "$productName" },
          productCode: { $first: "$productCode" },
          SKU: { $first: "$SKU" },
          unitOfMeasure: { $first: "$unitOfMeasure" },
        },
      },
      // Calculate uniqueCreditPersons count
      {
        $addFields: {
          uniqueCreditPersonsCount: { $size: "$uniqueCreditPersons" },
        },
      },
      // Sort by total quantity descending
      {
        $sort: { totalQuantity: -1 },
      },
      // Lookup inventory details to get complete product information
      {
        $lookup: {
          from: "inventories",
          localField: "_id",
          foreignField: "_id",
          as: "inventory",
        },
      },
      // Unwind inventory array (should be single item)
      {
        $unwind: {
          path: "$inventory",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Project final structure without credit person details lookup
      {
        $project: {
          _id: 0,
          inventoryId: "$_id",
          productName: { $ifNull: ["$inventory.productName", "$productName"] },
          productCode: { $ifNull: ["$inventory.productCode", "$productCode"] },
          SKU: { $ifNull: ["$inventory.SKU", "$SKU"] },
          unitOfMeasure: {
            $ifNull: ["$inventory.unitOfMeasure", "$unitOfMeasure"],
          },
          category: "$inventory.category",
          subCategory: "$inventory.subCategory",
          brand: "$inventory.brand",
          totalQuantity: 1,
          totalOrders: 1,
          uniqueCreditPersonsCount: 1,
          creditPersons: 1,
        },
      },
    ]);

    // Now fetch credit person details separately and merge
    const allCreditPersonIds = new Set();
    productAnalytics.forEach((product) => {
      product.creditPersons.forEach((cp) => {
        allCreditPersonIds.add(cp.creditPersonId);
      });
    });

    const creditPersonDetails = await CreditPerson.find({
      _id: { $in: Array.from(allCreditPersonIds) },
    }).select("_id name phone");

    // Create a map for quick lookup
    const creditPersonMap = {};
    creditPersonDetails.forEach((cp) => {
      creditPersonMap[cp._id.toString()] = cp;
    });

    // Merge credit person details into the results
    productAnalytics.forEach((product) => {
      product.creditPersons.forEach((cp) => {
        const creditPerson = creditPersonMap[cp.creditPersonId.toString()];
        if (creditPerson) {
          cp.name = creditPerson.name;
          cp.phone = creditPerson.phone || "";
        } else {
          cp.name = "Unknown";
          cp.phone = "";
        }
      });

      // Sort credit persons by quantity descending
      product.creditPersons.sort((a, b) => b.totalQuantity - a.totalQuantity);
    });

    // Calculate totals across all products
    const totals = productAnalytics.reduce(
      (acc, item) => {
        acc.totalQuantity += item.totalQuantity;
        acc.totalOrders += item.totalOrders;
        acc.totalUniqueProducts += 1;
        acc.totalUniqueCreditPersons += item.uniqueCreditPersonsCount;
        return acc;
      },
      {
        totalQuantity: 0,
        totalOrders: 0,
        totalUniqueProducts: 0,
        totalUniqueCreditPersons: 0,
      }
    );

    // Get date range info
    const dateRange = {
      startDate: parsedStartDate || (startDate ? new Date(startDate) : null),
      endDate: parsedEndDate || (endDate ? new Date(endDate) : null),
    };

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Sale products analytics by credit person fetched successfully",
      data: {
        storefront: storefront
          ? {
              _id: storefront._id,
              locationName: storefront.locationName,
              locationCode: storefront.locationCode,
            }
          : null,
        dateRange,
        totals: {
          totalQuantity: totals.totalQuantity,
          totalOrders: totals.totalOrders,
          totalUniqueProducts: totals.totalUniqueProducts,
          totalUniqueCreditPersons: totals.totalUniqueCreditPersons,
        },
        products: productAnalytics,
      },
    });
  }
);


