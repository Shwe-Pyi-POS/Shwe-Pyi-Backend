import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";
import { logActivity } from "../services/activityLog.service.js";
import XLSX from "xlsx";
import {
  createStockAuditLog,
  determineActionType,
} from "../services/stockAuditLog.service.js";

const parseExcelRowProductCode = (row) =>
  row.productCode || row.product_code || row["Product Code"];

const parseExcelRowQuantity = (row) =>
  row.quantity ?? row.qty ?? row["Quantity"] ?? row["Qty"];

export const createStorefrontInventory = asyncErrorHandler(
  async (req, res, next) => {
    const { inventoryIds, storefrontId, quantity = 0 } = req.body;

    // Validate storefrontId
    if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
      return next(new CustomError(400, "Invalid storefront ID format"));
    }

    // Validate inventoryIds - should be an array
    if (!Array.isArray(inventoryIds) || inventoryIds.length === 0) {
      return next(
        new CustomError(
          400,
          "inventoryIds must be a non-empty array of inventory IDs",
        ),
      );
    }

    // Validate quantity
    if (quantity < 0) {
      return next(new CustomError(400, "Quantity cannot be negative"));
    }

    // Validate all inventoryIds are valid MongoDB ObjectIds
    const invalidIds = inventoryIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );
    if (invalidIds.length > 0) {
      return next(
        new CustomError(
          400,
          `Invalid inventory ID format(s): ${invalidIds.join(", ")}`,
        ),
      );
    }

    // Check if storefront exists
    const storefront = await LocationProfile.findOne({
      _id: storefrontId,
      type: "storefront",
    });
    if (!storefront) {
      return next(new CustomError(404, "Storefront not found"));
    }

    // Check if storefront is deleted
    if (storefront.isDeleted) {
      return next(new CustomError(404, "Storefront is deleted"));
    }

    // Check if all inventories exist
    const inventories = await Inventory.find({
      _id: { $in: inventoryIds },
    });
    const foundInventoryIds = inventories.map((inv) => inv._id.toString());
    const missingInventoryIds = inventoryIds.filter(
      (id) => !foundInventoryIds.includes(id.toString()),
    );
    if (missingInventoryIds.length > 0) {
      return next(
        new CustomError(
          404,
          `Inventory not found for ID(s): ${missingInventoryIds.join(", ")}`,
        ),
      );
    }

    // Check which combinations already exist
    const existingRecords = await StorefrontInventory.find({
      inventoryId: { $in: inventoryIds },
      storefrontId,
    });

    const existingInventoryIds = existingRecords.map((record) =>
      record.inventoryId.toString(),
    );
    const newInventoryIds = inventoryIds.filter(
      (id) => !existingInventoryIds.includes(id.toString()),
    );

    // Create new records for inventoryIds that don't exist
    // Use Promise.allSettled to handle each creation individually
    const createdRecords = [];
    const duplicateRecords = [];

    if (newInventoryIds.length > 0) {
      const createPromises = newInventoryIds.map(async (inventoryId) => {
        try {
          const record = await StorefrontInventory.create({
            inventoryId,
            storefrontId,
            quantity,
          });
          await record.populate("inventoryId", "productName productCode");
          await record.populate("storefrontId", "locationName locationCode");
          return { status: "created", record };
        } catch (error) {
          // Handle duplicate key error (unique constraint violation - error code 11000)
          if (error.code === 11000) {
            // If duplicate, fetch the existing record
            const existingRecord = await StorefrontInventory.findOne({
              inventoryId,
              storefrontId,
            });
            if (existingRecord) {
              await existingRecord.populate(
                "inventoryId",
                "productName productCode",
              );
              await existingRecord.populate(
                "storefrontId",
                "locationName locationCode",
              );
              return { status: "duplicate", record: existingRecord };
            }
          }
          // For other errors, rethrow to be handled by asyncErrorHandler
          throw error;
        }
      });

      const results = await Promise.allSettled(createPromises);

      // Process results - collect created and duplicate records
      for (const result of results) {
        if (result.status === "fulfilled") {
          const { status, record } = result.value;
          if (status === "created") {
            createdRecords.push(record);
          } else if (status === "duplicate") {
            duplicateRecords.push(record);
          }
        } else {
          // If creation failed for unexpected reasons, throw to be handled by asyncErrorHandler
          throw result.reason;
        }
      }
    }

    // Combine existing records with duplicates found during creation
    const allExistingRecords = [...existingRecords, ...duplicateRecords];

    // Populate existing records for response (if not already populated)
    for (const record of existingRecords) {
      if (!record.populated("inventoryId")) {
        await record.populate("inventoryId", "productName productCode");
        await record.populate("storefrontId", "locationName locationCode");
      }
    }

    logActivity({
      admin: req.user._id,
      action: "create",
      feature: "storefront_stock",
      description: `Added ${createdRecords.length} inventory items to storefront`,
      targetModel: "StorefrontInventory",
      metadata: { storefrontId, inventoryCount: inventoryIds.length, created: createdRecords.length },
      ip: req.ip,
    });
    res.status(201).json({
      success: true,
      message: `Processed ${inventoryIds.length} inventory record(s)`,
      data: {
        created: createdRecords,
        alreadyExists: allExistingRecords,
        summary: {
          total: inventoryIds.length,
          created: createdRecords.length,
          alreadyExists: allExistingRecords.length,
        },
      },
    });
  },
);

// Get all storefront inventory with filtering, pagination, and sorting
export const getAllStorefrontInventory = asyncErrorHandler(
  async (req, res, next) => {
    const {
      page,
      limit,
      storefrontId,
      inventoryId,
      isLowStock,
      search,
      category,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query = {};

    if (storefrontId) {
      if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
        return next(new CustomError(400, "Invalid storefront ID format"));
      }
      query.storefrontId = new mongoose.Types.ObjectId(storefrontId);
    }

    if (inventoryId) {
      if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
        return next(new CustomError(400, "Invalid inventory ID format"));
      }
      query.inventoryId = new mongoose.Types.ObjectId(inventoryId);
    }

    if (isLowStock !== undefined) {
      query.isLowStock = isLowStock === "true";
    }

    if (search) {
      // Search in populated fields - we'll need to search after population
      // For now, search by productCode if it matches ObjectId pattern, otherwise skip
      if (mongoose.Types.ObjectId.isValid(search)) {
        query.$or = [{ inventoryId: search }, { storefrontId: search }];
      }
    }

    // Build aggregation pipeline to filter by status (since status is in Inventory model)
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: "inventories",
          localField: "inventoryId",
          foreignField: "_id",
          as: "inventoryId",
        },
      },
      { $unwind: "$inventoryId" },
      { $match: { "inventoryId.status": "active" } },
    ];

    if (category) {
      pipeline.push({ $match: { "inventoryId.category": category } });
    }

    pipeline.push(
      {
        $lookup: {
          from: "locationprofiles",
          localField: "storefrontId",
          foreignField: "_id",
          as: "storefrontId",
        },
      },
      { $unwind: "$storefrontId" },
      {
        $project: {
          _id: 1,
          quantity: 1,
          availableQuantity: "$quantity",
          isLowStock: 1,
          lastUpdated: 1,
          createdAt: 1,
          updatedAt: 1,
          "inventoryId._id": 1,
          "inventoryId.productName": 1,
          "inventoryId.productCode": 1,
          "inventoryId.SKU": 1,
          "inventoryId.category": 1,
          "inventoryId.sellingPrice": 1,
          "inventoryId.barcode": 1,
          "inventoryId.status": 1,
          "inventoryId.unitOfMeasure": 1,
          "inventoryId.uomConversions": 1,
          "storefrontId._id": 1,
          "storefrontId.locationName": 1,
          "storefrontId.locationCode": 1,
        },
      },
    );

    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { "inventoryId.productName": { $regex: search, $options: "i" } },
            { "inventoryId.productCode": { $regex: search, $options: "i" } },
            { "inventoryId.barcode": { $regex: search, $options: "i" } },
          ],
        },
      });
    }

    // Build query chain using aggregate for status filtering and summary statistics
    const summaryPipeline = [
      ...pipeline,
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalQuantity: { $sum: "$quantity" },
          totalAmount: {
            $sum: { $multiply: ["$quantity", "$inventoryId.sellingPrice"] },
          },
        },
      },
    ];

    const summaryResult = await StorefrontInventory.aggregate(summaryPipeline);
    const summary =
      summaryResult.length > 0
        ? {
            totalProducts: summaryResult[0].totalProducts,
            totalQuantity: summaryResult[0].totalQuantity,
            totalAmount: summaryResult[0].totalAmount,
          }
        : {
            totalProducts: 0,
            totalQuantity: 0,
            totalAmount: 0,
          };

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    pipeline.push({ $sort: sort });

    // Apply pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const usePagination = page !== undefined || limit !== undefined;
    if (usePagination) {
      pipeline.push({ $skip: skip });
      pipeline.push({ $limit: limitNum });
    }

    // Execute aggregate query
    const stock = await StorefrontInventory.aggregate(pipeline);

    // Add quantityByUnit (computed from uomConversions) to each item
    const enrichedStock = stock.map((item) => {
      const uomConversions = item.inventoryId?.uomConversions || [];
      const baseUnit = item.inventoryId?.unitOfMeasure || "piece";
      const baseQty = item.quantity || 0;

      const quantityByUnit = { [baseUnit]: baseQty };
      for (const conv of uomConversions) {
        quantityByUnit[conv.unit] = baseQty * conv.factor;
      }
      return { ...item, quantityByUnit };
    });

    const response = {
      success: true,
      message:
        "Storefront inventory retrieved successfully (Active products only)",
      summary,
      data: enrichedStock,
    };

    if (usePagination) {
      response.pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(summary.totalProducts / limitNum),
        totalItems: summary.totalProducts,
        itemsPerPage: limitNum,
      };
    }

    res.status(200).json(response);
  },
);

// Get storefront inventory by ID
export const getStorefrontInventoryById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(
        new CustomError(400, "Invalid storefront inventory ID format"),
      );
    }

    const stock = await StorefrontInventory.findById(id)
      .populate(
        "inventoryId",
        "productName productCode SKU category buyingPrice sellingPrice barcode status unitOfMeasure uomConversions",
      )
      .populate("storefrontId", "locationName locationCode locationAddress");

    if (!stock) {
      return next(new CustomError(404, "Storefront inventory not found"));
    }

    // Add quantityByUnit
    const uomConversions = stock.inventoryId?.uomConversions || [];
    const baseUnit = stock.inventoryId?.unitOfMeasure || "piece";
    const baseQty = stock.quantity || 0;
    const quantityByUnit = { [baseUnit]: baseQty };
    for (const conv of uomConversions) {
      quantityByUnit[conv.unit] = baseQty * conv.factor;
    }

    res.status(200).json({
      success: true,
      message: "Storefront inventory retrieved successfully",
      data: { ...stock.toObject(), quantityByUnit },
    });
  },
);

// Update storefront inventory quantity with ACID properties
// Uses quantityChange: positive number = add, negative number = subtract
export const updateStorefrontInventoryQuantity = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { quantityChange, reason } = req.body;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(
        new CustomError(400, "Invalid storefront inventory ID format"),
      );
    }

    // Validate quantityChange
    if (
      typeof quantityChange !== "number" ||
      quantityChange === 0 ||
      !Number.isFinite(quantityChange)
    ) {
      return next(
        new CustomError(
          400,
          "A valid non-zero numeric 'quantityChange' is required. Use positive number to add, negative number to subtract.",
        ),
      );
    }

    // Get admin ID from authenticated user
    const adminId = req.user?._id;
    if (!adminId) {
      return next(
        new CustomError(401, "Authentication required. Admin ID not found."),
      );
    }

    // Start MongoDB session for transaction (ACID properties)
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find the stock before the update to get the current quantity
      // Populate inventoryId to get product name for error messages
      const stockToUpdate = await StorefrontInventory.findById(id)
        .populate("inventoryId", "productName productCode SKU")
        .populate("storefrontId", "locationName locationCode type")
        .session(session);

      if (!stockToUpdate) {
        await session.abortTransaction();
        session.endSession();
        return next(new CustomError(404, "Storefront inventory not found"));
      }

      // Validate storefront exists and is not deleted
      if (stockToUpdate.storefrontId?.isDeleted) {
        await session.abortTransaction();
        session.endSession();
        return next(new CustomError(404, "Storefront is deleted"));
      }

      // Validate location type
      if (stockToUpdate.storefrontId?.type !== "storefront") {
        await session.abortTransaction();
        session.endSession();
        return next(new CustomError(400, "Location is not a storefront"));
      }

      const beforeQuantity = stockToUpdate.quantity || 0;
      const afterQuantity = beforeQuantity + quantityChange;

      // Validate that the new quantity won't be negative
      if (afterQuantity < 0) {
        await session.abortTransaction();
        session.endSession();
        return next(
          new CustomError(
            400,
            `Cannot update storefront inventory quantity. Current quantity: ${beforeQuantity}, requested change: ${quantityChange}. This would result in a negative quantity (${afterQuantity}).`,
          ),
        );
      }

      // Perform the update using findByIdAndUpdate with $inc for atomic operation
      const updatedStock = await StorefrontInventory.findByIdAndUpdate(
        id,
        {
          $inc: { quantity: quantityChange },
          $set: { lastUpdated: new Date() },
        },
        { new: true, runValidators: true, session },
      )
        .populate(
          "inventoryId",
          "productName productCode SKU category barcode status",
        )
        .populate("storefrontId", "locationName locationCode");

      // Create audit log entry
      const action = determineActionType(quantityChange, false);
      await createStockAuditLog({
        inventoryId: stockToUpdate.inventoryId._id,
        adminId: adminId,
        locationId: stockToUpdate.storefrontId._id,
        locationType: "storefront",
        stockRecordId: id,
        beforeQuantity: beforeQuantity,
        afterQuantity: afterQuantity,
        quantityChange: quantityChange,
        action: action,
        reason: reason || null,
        relatedTransactionId: null,
        relatedTransactionType: null,
        session: session,
      });

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // Determine action type for response message
      const actionType = quantityChange > 0 ? "add" : "remove";
      const actionMessage =
        quantityChange > 0
          ? `increased by ${Math.abs(quantityChange)}`
          : `decreased by ${Math.abs(quantityChange)}`;

      logActivity({
        admin: adminId,
        action: "update_quantity",
        feature: "storefront_stock",
        description: `Storefront stock ${actionMessage} (change: ${quantityChange})`,
        targetId: updatedStock._id,
        targetModel: "StorefrontInventory",
        metadata: { inventoryId: updatedStock.inventoryId?._id, storefrontId: stockToUpdate.storefrontId?._id, quantityChange, newQuantity: updatedStock.quantity },
        ip: req.ip,
      });
      res.status(200).json({
        success: true,
        message: `Storefront inventory quantity ${actionMessage} successfully. New quantity: ${updatedStock.quantity}`,
        data: updatedStock,
        operation: {
          type: actionType,
          previousQuantity: beforeQuantity,
          newQuantity: updatedStock.quantity,
          quantityChange: quantityChange,
        },
      });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();

      // If it's already a CustomError, pass it through
      if (error instanceof CustomError) {
        return next(error);
      }

      // Otherwise, create a new error
      return next(
        new CustomError(
          500,
          `Failed to update storefront inventory quantity: ${error.message}`,
        ),
      );
    }
  },
);

// Bulk add storefront inventory quantities from Excel (partial success per row)
export const importStorefrontInventoryFromExcel = asyncErrorHandler(
  async (req, res, next) => {
    if (!req.file) {
      return next(new CustomError(400, "Please upload an Excel file"));
    }

    const storefrontId = req.body.storefrontId || req.query.storefrontId;
    if (!storefrontId) {
      return next(new CustomError(400, "storefrontId is required"));
    }
    if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
      return next(new CustomError(400, "Invalid storefront ID format"));
    }

    const adminId = req.user?._id;
    if (!adminId) {
      return next(
        new CustomError(401, "Authentication required. Admin ID not found."),
      );
    }

    const storefront = await LocationProfile.findOne({
      _id: storefrontId,
      type: "storefront",
    });
    if (!storefront) {
      return next(new CustomError(404, "Storefront not found"));
    }
    if (storefront.isDeleted) {
      return next(new CustomError(404, "Storefront is deleted"));
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      return next(new CustomError(400, "Excel file is empty"));
    }

    const results = {
      total: rows.length,
      success: 0,
      skipped: 0,
      failed: 0,
      updated: [],
      skippedRows: [],
      errors: [],
    };

    const reason = req.body.reason || "Excel bulk import";

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      try {
        const productCodeRaw = parseExcelRowProductCode(row);
        const quantityRaw = parseExcelRowQuantity(row);

        if (!productCodeRaw) {
          throw new Error("Product code is required");
        }

        if (
          quantityRaw === undefined ||
          quantityRaw === null ||
          quantityRaw === ""
        ) {
          throw new Error("Quantity is required");
        }

        const quantityToAdd = Number(quantityRaw);
        if (
          !Number.isFinite(quantityToAdd) ||
          quantityToAdd <= 0 ||
          !Number.isInteger(quantityToAdd)
        ) {
          throw new Error("Quantity must be a positive whole number");
        }

        const productCode = String(productCodeRaw).trim().toUpperCase();
        const inventory = await Inventory.findOne({ productCode });

        if (!inventory) {
          results.skipped++;
          results.skippedRows.push({
            row: rowNum,
            productCode,
            message: `Product code '${productCode}' not found — skipped`,
          });
          continue;
        }

        let stock = await StorefrontInventory.findOne({
          inventoryId: inventory._id,
          storefrontId,
        });

        const beforeQuantity = stock?.quantity ?? 0;
        const isNewRecord = !stock;

        if (!stock) {
          stock = await StorefrontInventory.create({
            inventoryId: inventory._id,
            storefrontId,
            quantity: 0,
          });
        }

        const updatedStock = await StorefrontInventory.findByIdAndUpdate(
          stock._id,
          {
            $inc: { quantity: quantityToAdd },
            $set: { lastUpdated: new Date() },
          },
          { new: true, runValidators: true },
        );

        const afterQuantity = updatedStock.quantity;
        const action = determineActionType(quantityToAdd, isNewRecord);

        await createStockAuditLog({
          inventoryId: inventory._id,
          adminId,
          locationId: storefrontId,
          locationType: "storefront",
          stockRecordId: stock._id,
          beforeQuantity,
          afterQuantity,
          quantityChange: quantityToAdd,
          action,
          reason,
        });

        results.success++;
        results.updated.push({
          row: rowNum,
          productCode,
          productName: inventory.productName,
          quantityAdded: quantityToAdd,
          previousQuantity: beforeQuantity,
          newQuantity: afterQuantity,
        });
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          message: error.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Import completed: ${results.success} updated, ${results.skipped} skipped, ${results.failed} failed out of ${results.total}`,
      data: results,
    });
  },
);
