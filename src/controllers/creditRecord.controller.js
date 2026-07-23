import mongoose from "mongoose";
import CreditRecord from "../models/creditRecord.model.js";
import Order from "../models/orders.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import { logActivity } from "../services/activityLog.service.js";

// Create credit record payment (for partial/full payment on credit orders)
export const createCreditPayment = asyncErrorHandler(async (req, res, next) => {
  const { orderId, paidAmount, paymentMethod = "cash", notes } = req.body;
  const addedBy = req.user._id;
  // Validate required fields
  if (!orderId) {
    return next(new CustomError(400, "Order ID is required"));
  }

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (!paidAmount && paidAmount !== 0) {
    return next(new CustomError(400, "Paid amount is required"));
  }

  if (paidAmount === 0) {
    return next(new CustomError(400, "Paid amount cannot be zero"));
  }

  // Start MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    // Start transaction
    await session.withTransaction(async () => {
      // 1. Validate order exists and is not deleted
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new CustomError(404, "Order not found");
      }

      if (order.isDeleted) {
        throw new CustomError(400, "Cannot add payment to deleted order");
      }

      // 2. Validate order is a credit order
      if (order.paymentType !== "credit") {
        throw new CustomError(
          400,
          "Can only add payments to credit orders. This order is not a credit order."
        );
      }

      // 3. Calculate current remaining balance
      // Note: order.paidAmount should already include all previous credit payments
      // (it's updated when each credit payment is recorded)
      // So we can use it directly as the total paid so far
      const totalPaidSoFar = order.paidAmount || 0;
      const currentRemainingBalance = Math.max(
        0,
        order.finalAmount - totalPaidSoFar
      );

      // 4. Validate payment amount based on sign
      if (paidAmount > 0) {
        // For positive amounts: validate payment doesn't exceed remaining balance
        if (paidAmount > currentRemainingBalance) {
          throw new CustomError(
            400,
            `Payment amount (${paidAmount}) exceeds remaining balance (${currentRemainingBalance}). Maximum payment allowed: ${currentRemainingBalance}`
          );
        }
      } else {
        // For negative amounts: validate that order.paidAmount won't go below 0
        const newPaidAmount = totalPaidSoFar + paidAmount;
        if (newPaidAmount < 0) {
          throw new CustomError(
            400,
            `Correction amount (${paidAmount}) would result in negative paid amount. Current paid amount: ${totalPaidSoFar}. Maximum correction allowed: ${-totalPaidSoFar}`
          );
        }
      }

      // 5. Create credit record payment
      // Auto-populate creditPersonId from order for easier querying
      const creditRecordData = {
        orderId: new mongoose.Types.ObjectId(orderId),
        creditPersonId: order.creditPersonId || null,
        paidAmount,
        paymentDate: new Date(),
        paymentMethod: paymentMethod || "cash",
        notes: notes || null,
        addedBy,
      };

      const creditRecordArray = await CreditRecord.create([creditRecordData], {
        session,
      });
      const creditRecord = creditRecordArray[0];

      // 6. Update order's paidAmount to include this credit payment
      // IMPORTANT: We modify the order's paidAmount field here
      // This denormalizes the data for easier querying and maintains consistency
      // The order.paidAmount accumulates all credit payments made for this order
      const previousOrderPaidAmount = order.paidAmount || 0;
      order.paidAmount = previousOrderPaidAmount + paidAmount;
      order.lastPaymentDate = new Date();
      await order.save({ session });

      // 7. Get the updated paidAmount from the order (already saved above)
      // The order.paidAmount has been modified and saved in step 6
      const updatedTotalPaid = order.paidAmount;
      const newRemainingBalance = Math.max(
        0,
        order.finalAmount - updatedTotalPaid
      );
      const isFullyPaid = newRemainingBalance <= 0;

      // 8. Populate creditPersonId for response (orderId will be manually constructed)
      if (creditRecord.creditPersonId) {
        await creditRecord.populate("creditPersonId", "name phone");
      }

      // 9. Construct clean creditRecord object for response
      // Manually build orderId object to avoid virtual fields from Order schema
      const creditRecordResponse = creditRecord.toObject();
      creditRecordResponse.orderId = {
        _id: order._id,
        orderNumber: order.orderNumber,
        finalAmount: order.finalAmount,
        paymentType: order.paymentType,
        paidAmount: order.paidAmount, // Include updated paidAmount
      };

      // 10. Send response
      logActivity({
        admin: addedBy,
        action: "create_payment",
        feature: "credit",
        description: `Credit payment ${paidAmount} MMK recorded for order ${order.orderNumber}`,
        targetId: creditRecord._id,
        targetModel: "CreditRecord",
        metadata: { orderId: order._id, paidAmount, orderNumber: order.orderNumber },
        ip: req.ip,
      });
      res.status(201).json({
        success: true,
        message: "Credit payment recorded successfully",
        data: {
          creditRecord: creditRecordResponse,
          order: {
            orderNumber: order.orderNumber,
            finalAmount: order.finalAmount,
            previousRemainingBalance: currentRemainingBalance,
            previousPaidAmount: totalPaidSoFar, // Previous total paid
            paymentAmount: paidAmount,
            newPaidAmount: updatedTotalPaid, // New total paid (updated in order)
            newRemainingBalance: newRemainingBalance,
            isFullyPaid,
          },
        },
      });
    });
  } catch (error) {
    // Handle transaction errors
    if (error instanceof CustomError) {
      return next(error);
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(
        new CustomError(400, `Validation error: ${errors.join(". ")}`)
      );
    }

    // For other errors, log and return with actual error message
    console.error("Credit payment creation error:", error);
    const errorMessage =
      error?.message || String(error) || "Unknown error occurred";
    return next(
      new CustomError(500, `Credit payment creation failed: ${errorMessage}`)
    );
  } finally {
    // Always end the session
    await session.endSession();
  }
});

// Get all credit records for an order
export const getCreditRecordsByOrderId = asyncErrorHandler(
  async (req, res, next) => {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return next(new CustomError(400, "Invalid order ID format"));
    }

    // Validate order exists
    const order = await Order.findById(orderId);
    if (!order) {
      return next(new CustomError(404, "Order not found"));
    }

    // Get all credit records for this order
    const creditRecords = await CreditRecord.find({
      orderId,
      isDeleted: false,
    })
      .sort({ paymentDate: -1 }) // Sort by newest payment first
      .populate("orderId", "orderNumber finalAmount paymentType lastPaymentDate dueDate");

    // Calculate total paid from credit records
    const totalCreditPayments = creditRecords.reduce(
      (sum, record) => sum + (record.paidAmount || 0),
      0
    );

    // Calculate remaining balance
    // Note: order.paidAmount already includes all credit payments (updated on each createCreditPayment)
    // So totalPaid = order.paidAmount (NOT order.paidAmount + totalCreditPayments)
    const totalPaid = order.paidAmount || 0;
    const initialPaidAmount = Math.max(0, totalPaid - totalCreditPayments);
    const remainingBalance = Math.max(0, order.finalAmount - totalPaid);

    // Add remaining balance after each payment to individual records
    // Records are sorted newest first, so process in reverse for running total
    const orderFinalAmount = order.finalAmount;
    let runningPaidAmount = initialPaidAmount;
    const recordsWithBalance = creditRecords.map((record) => {
      const recordObj = record.toObject();
      // Calculate running paid amount up to and including this record
      // Process reverse-order since records are newest-first
      return recordObj;
    });

    // Process from oldest (end) to newest (start) to accumulate running total
    for (let i = recordsWithBalance.length - 1; i >= 0; i--) {
      runningPaidAmount += recordsWithBalance[i].paidAmount || 0;
      recordsWithBalance[i].remainingBalanceAfterPayment = Math.max(
        0,
        orderFinalAmount - runningPaidAmount
      );
    }

    res.status(200).json({
      success: true,
      message: "Credit records retrieved successfully",
      data: {
        order: {
          orderNumber: order.orderNumber,
          finalAmount: order.finalAmount,
          initialPaidAmount,
          totalPaidAmount: totalPaid,
          remainingBalance,
          lastPaymentDate: order.lastPaymentDate || null,
          dueDate: order.dueDate || null,
        },
        creditRecords: {
          count: recordsWithBalance.length,
          records: recordsWithBalance,
        },
      },
    });
  }
);

// Get all credit records (with filtering)
export const getAllCreditRecords = asyncErrorHandler(async (req, res, next) => {
  const {
    orderId,
    creditPersonId,
    paymentMethod,
    startDate,
    endDate,
    page,
    limit,
  } = req.query;

  // Build query
  const query = { isDeleted: false };

  // Filter by orderId if provided
  if (orderId) {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return next(new CustomError(400, "Invalid order ID format"));
    }
    query.orderId = orderId;
  }

  // Filter by creditPersonId if provided
  if (creditPersonId) {
    if (!mongoose.Types.ObjectId.isValid(creditPersonId)) {
      return next(new CustomError(400, "Invalid credit person ID format"));
    }
    query.creditPersonId = creditPersonId;
  }

  // Filter by paymentMethod if provided
  if (paymentMethod) {
    query.paymentMethod = paymentMethod;
  }

  // Add date range filter using dateFilter utility
  // Filter by the 'paymentDate' field (when the payment was made)
  try {
    // We pass req.query which contains startDate and endDate
    const dateFilter = createDateFilter(req.query, "paymentDate", false);
    Object.assign(query, dateFilter);
  } catch (error) {
    // If it's a CustomError, pass it to error handler
    if (error instanceof CustomError) {
      return next(error);
    }
    // For other errors, wrap and pass
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // Execute query with optional pagination
  let creditRecordsQuery = CreditRecord.find(query)
    .populate("orderId", "orderNumber finalAmount paymentType lastPaymentDate dueDate")
    .populate("creditPersonId", "name phone")
    .populate("addedBy", "name email")
    .sort({ paymentDate: -1 });

  let pagination = null;

  if (page || limit) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    creditRecordsQuery = creditRecordsQuery.skip(skip).limit(limitNum);

    const total = await CreditRecord.countDocuments(query);
    pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    };
  }

  const creditRecords = await creditRecordsQuery;

  const response = {
    success: true,
    message: "Credit records retrieved successfully",
    data: creditRecords,
  };

  if (pagination) {
    response.pagination = pagination;
  }

  res.status(200).json(response);
});

//Pending feature
// Get credit record by ID
export const getCreditRecordById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid credit record ID format"));
  }

  const creditRecord = await CreditRecord.findOne({
    _id: id,
    isDeleted: false,
  }).populate("orderId", "orderNumber finalAmount paymentType lastPaymentDate dueDate");

  if (!creditRecord) {
    return next(new CustomError(404, "Credit record not found"));
  }

  res.status(200).json({
    success: true,
    message: "Credit record retrieved successfully",
    data: creditRecord,
  });
});

// Get all credit records for a specific credit person
export const getCreditRecordsByCreditPersonId = asyncErrorHandler(
  async (req, res, next) => {
    const { creditPersonId } = req.params;
    const { page = 1, limit = 10, paymentMethod, paymentType } = req.query;

    if (!mongoose.Types.ObjectId.isValid(creditPersonId)) {
      return next(new CustomError(400, "Invalid credit person ID format"));
    }

    // Validate paymentType if provided
    if (paymentType !== undefined) {
      const validPaymentTypes = ["credit", "paid"];
      if (!validPaymentTypes.includes(paymentType)) {
        return next(
          new CustomError(
            400,
            `Invalid payment type. Allowed values: ${validPaymentTypes.join(
              ", "
            )}`
          )
        );
      }
    }

    // Validate credit person exists
    const CreditPerson = mongoose.model("CreditPerson");
    const creditPerson = await CreditPerson.findById(creditPersonId);
    if (!creditPerson) {
      return next(new CustomError(404, "Credit person not found"));
    }

    // Build order query
    const orderQuery = {
      creditPersonId: creditPersonId,
      isDeleted: false,
    };

    // Filter by paymentType if provided, otherwise default to "credit" (since credit records are for credit orders)
    if (paymentType !== undefined) {
      orderQuery.paymentType = paymentType;
    } else {
      orderQuery.paymentType = "credit"; // Default to credit orders
    }

    // Find all orders for this credit person - for summary information
    const orders = await Order.find(orderQuery).select(
      "_id orderNumber finalAmount paidAmount lastPaymentDate dueDate"
    );

    if (orders.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No credit records found for this credit person",
        data: {
          creditPerson: {
            _id: creditPerson._id,
            name: creditPerson.name,
            phone: creditPerson.phone,
          },
          orders: [],
          creditRecords: {
            count: 0,
            records: [],
          },
          summary: {
            totalCreditRecords: 0,
            totalPaidAmount: 0,
            totalOutstandingAmount: 0,
          },
        },
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: parseInt(limit),
        },
      });
    }

    // Build query for credit records
    const query = {
      creditPersonId: creditPersonId,
      isDeleted: false,
    };

    // Filter by orderIds if paymentType is specified (to only get credit records for orders with that paymentType)
    if (paymentType !== undefined) {
      const orderIds = orders.map((order) => order._id);
      query.orderId = { $in: orderIds };
    }

    // Add paymentMethod filter if provided
    if (paymentMethod !== undefined && paymentMethod !== "") {
      // Trim whitespace from paymentMethod
      query.paymentMethod = paymentMethod.trim();
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get credit records with pagination
    const creditRecords = await CreditRecord.find(query)
      .populate({
        path: "orderId",
        select: "orderNumber paidAmount finalAmount lastPaymentDate",
      })
      .populate("addedBy", "name role")
      .sort({ paymentDate: -1 })
      .skip(skip)
      .limit(limitNum);

    // Get total count
    const total = await CreditRecord.countDocuments(query);

    // Calculate summary statistics
    // Get all credit records (without pagination) for summary
    const allCreditRecords = await CreditRecord.find(query);
    const totalCreditPayments = allCreditRecords.reduce(
      (sum, record) => sum + (record.paidAmount || 0),
      0
    );

    // Calculate outstanding for each order
    // Note: order.paidAmount already includes all credit payments (updated when each credit payment is recorded)
    // So we can use it directly as the total paid amount
    let totalOutstanding = 0;
    const orderMap = new Map();
    for (const order of orders) {
      const orderTotalPaid = order.paidAmount || 0;
      const orderOutstanding = order.finalAmount - orderTotalPaid;
      totalOutstanding += Math.max(0, orderOutstanding);
      orderMap.set(order._id.toString(), {
        finalAmount: order.finalAmount,
        paidAmount: order.paidAmount,
      });
    }

    // Group paginated credit records by order and calculate remainingBalanceAfterPayment per record
    const recordsByOrder = new Map();
    creditRecords.forEach((record) => {
      const orderIdStr = record.orderId._id.toString();
      if (!recordsByOrder.has(orderIdStr)) {
        recordsByOrder.set(orderIdStr, []);
      }
      recordsByOrder.get(orderIdStr).push(record);
    });

    const creditRecordsWithBalance = [];
    recordsByOrder.forEach((records, orderIdStr) => {
      const orderData = orderMap.get(orderIdStr);
      if (!orderData) {
        records.forEach((r) => creditRecordsWithBalance.push(r.toObject()));
        return;
      }

      const creditPaymentsSum = records.reduce(
        (sum, r) => sum + (r.paidAmount || 0),
        0
      );
      const initialPaidAmount = Math.max(
        0,
        orderData.paidAmount - creditPaymentsSum
      );

      let runningPaid = initialPaidAmount;
      // Records are per-order newest-first, process from end (oldest) to start (newest)
      for (let i = records.length - 1; i >= 0; i--) {
        runningPaid += records[i].paidAmount || 0;
        const recordObj = records[i].toObject();
        recordObj.remainingBalanceAfterPayment = Math.max(
          0,
          orderData.finalAmount - runningPaid
        );
        // Only keep _id, orderNumber, lastPaymentDate in orderId
        recordObj.orderId = {
          _id: records[i].orderId._id,
          orderNumber: records[i].orderId.orderNumber,
          finalAmount: records[i].orderId.finalAmount,
          paidAmount: records[i].orderId.paidAmount,
          lastPaymentDate: records[i].orderId.lastPaymentDate || null,
          dueDate: records[i].orderId.dueDate || null,
        };
        // Format addedBy with name and role
        if (records[i].addedBy) {
          recordObj.addedBy = {
            _id: records[i].addedBy._id,
            name: records[i].addedBy.name,
            role: records[i].addedBy.role,
          };
        }
        // Remove internal fields from record
        delete recordObj.isDeleted;
        delete recordObj.deletedAt;
        delete recordObj.createdAt;
        delete recordObj.updatedAt;
        delete recordObj.__v;
        creditRecordsWithBalance.push(recordObj);
      }
    });

    // Sort by paymentDate newest-first to match original order
    creditRecordsWithBalance.sort(
      (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
    );

    res.status(200).json({
      success: true,
      message: "Credit records retrieved successfully",
      data: {
        creditPerson: {
          _id: creditPerson._id,
          name: creditPerson.name,
          phone: creditPerson.phone,
        },
        orders: orders.map((order) => ({
          _id: order._id,
          orderNumber: order.orderNumber,
          lastPaymentDate: order.lastPaymentDate || null,
          dueDate: order.dueDate || null,
        })),
        creditRecords: {
          count: creditRecordsWithBalance.length,
          records: creditRecordsWithBalance,
        },
        summary: {
          totalCreditRecords: total,
          totalPaidViaCreditRecords: totalCreditPayments,
          totalOutstandingAmount: totalOutstanding,
        },
      },
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  }
);

// Hard delete credit record
export const hardDeleteCreditRecord = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    // Validate credit record ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid credit record ID format"));
    }

    // Start MongoDB session for transaction
    const session = await mongoose.startSession();

    try {
      // Start transaction
      await session.withTransaction(async () => {
        // 1. Find the credit record first to validate it exists
        const creditRecord = await CreditRecord.findById(id).session(session);

        if (!creditRecord) {
          throw new CustomError(404, "Credit record not found");
        }

        // 2. Check if credit record is already deleted (soft delete)
        if (creditRecord.isDeleted) {
          throw new CustomError(
            400,
            "Credit record is already deleted (soft delete)"
          );
        }

        // 3. Get the associated order to update its paidAmount
        const order = await Order.findById(creditRecord.orderId).session(
          session
        );

        if (!order) {
          throw new CustomError(
            404,
            "Associated order not found. Cannot proceed with deletion."
          );
        }

        // 4. Populate references for response (before deletion)
        if (creditRecord.creditPersonId) {
          await creditRecord.populate("creditPersonId", "name phone");
        }

        // 5. Store credit record amount and previous order paid amount for response
        const creditRecordAmount = creditRecord.paidAmount || 0;
        const previousOrderPaidAmount = order.paidAmount || 0;

        // 6. Update order's paidAmount by subtracting the credit record's paidAmount
        // Since the credit record's paidAmount was added to order.paidAmount when created,
        // we need to subtract it when deleting
        const newOrderPaidAmount = Math.max(
          0,
          previousOrderPaidAmount - creditRecordAmount
        );
        order.paidAmount = newOrderPaidAmount;
        await order.save({ session });

        // 7. Hard delete the credit record
        await CreditRecord.findByIdAndDelete(id).session(session);

        // 7a. Recalculate lastPaymentDate from remaining credit records
        const remainingRecord = await CreditRecord.findOne({ orderId: order._id, isDeleted: false })
          .sort({ paymentDate: -1 })
          .session(session);
        order.lastPaymentDate = remainingRecord ? remainingRecord.paymentDate : null;
        await order.save({ session });

        // 8. Construct response data
        const creditRecordResponse = creditRecord.toObject();
        creditRecordResponse.orderId = {
          _id: order._id,
          orderNumber: order.orderNumber,
          finalAmount: order.finalAmount,
          paymentType: order.paymentType,
          previousPaidAmount: previousOrderPaidAmount,
          newPaidAmount: newOrderPaidAmount,
        };

        // 9. Send response
        res.status(200).json({
          success: true,
          message: "Credit record hard deleted successfully",
          data: {
            deletedCreditRecord: creditRecordResponse,
            order: {
              orderNumber: order.orderNumber,
              previousPaidAmount: previousOrderPaidAmount,
              deletedAmount: creditRecordAmount,
              newPaidAmount: newOrderPaidAmount,
              newRemainingBalance: Math.max(
                0,
                order.finalAmount - newOrderPaidAmount
              ),
            },
          },
        });
      });
    } catch (error) {
      // Handle transaction errors
      if (error instanceof CustomError) {
        return next(error);
      }

      // Handle validation errors
      if (error.name === "ValidationError") {
        const errors = Object.values(error.errors).map((val) => val.message);
        return next(
          new CustomError(400, `Validation error: ${errors.join(". ")}`)
        );
      }

      // For other errors, log and return with actual error message
      console.error("Hard delete credit record error:", error);
      const errorMessage =
        error?.message || String(error) || "Unknown error occurred";
      return next(
        new CustomError(
          500,
          `Failed to hard delete credit record: ${errorMessage}`
        )
      );
    } finally {
      // Always end the session
      await session.endSession();
    }
  }
);
