import mongoose from "mongoose";
import Transfer from "../models/transfer.model.js";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";

// Create new Transfer (supports both GRN → Warehouse and Warehouse → Storefront)
export const createTransfer = asyncErrorHandler(async (req, res, next) => {
  if (!req.user || !req.user._id) {
    return next(
      new CustomError(
        401,
        "Authentication required. Admin account ID is missing."
      )
    );
  }
  const transferredBy = req.user._id;
  // Support both camelCase and lowercase for lineItems
  const {
    sourceType, // "GRN", "Warehouse" or "Storefront"
    grnId, // For GRN transfers
    sourceWarehouseId, // For Warehouse → Storefront transfers
    sourceStorefrontId, // For Storefront → Warehouse transfers
    destinationWarehouseId, // For GRN → Warehouse or Storefront → Warehouse transfers
    destinationStorefrontId, // For Warehouse → Storefront or GRN → Storefront transfers
    lineItems,
    lineitems,
    transferDate,
    notes,
  } = req.body;

  // Use lineItems (camelCase) or fallback to lineitems (lowercase)
  const transferLineItems = lineItems || lineitems;

  // Determine sourceType if not provided (backward compatibility: default to GRN)
  const transferSourceType = sourceType || (grnId ? "GRN" : null);

  if (
    !transferSourceType ||
    !["GRN", "Warehouse", "Storefront"].includes(transferSourceType)
  ) {
    return next(
      new CustomError(
        400,
        "sourceType is required and must be 'GRN', 'Warehouse' or 'Storefront'"
      )
    );
  }

  let sourceId;
  let destinationId;
  let destinationType;

  // Handle GRN → Warehouse or GRN → Storefront transfer
  if (transferSourceType === "GRN") {
    if (!grnId) {
      return next(new CustomError(400, "grnId is required for GRN transfers"));
    }
    if (!mongoose.Types.ObjectId.isValid(grnId)) {
      return next(new CustomError(400, "Invalid GRN ID format"));
    }
    const isGRNToStorefront = !!destinationStorefrontId;
    const isGRNToWarehouse = !!destinationWarehouseId;
    if (!isGRNToStorefront && !isGRNToWarehouse) {
      return next(
        new CustomError(
          400,
          "Either destinationWarehouseId (GRN→Warehouse) or destinationStorefrontId (GRN→Storefront) is required"
        )
      );
    }
    if (isGRNToWarehouse) {
      if (!mongoose.Types.ObjectId.isValid(destinationWarehouseId)) {
        return next(new CustomError(400, "Invalid destination warehouse ID format"));
      }
    }
    if (isGRNToStorefront) {
      if (!mongoose.Types.ObjectId.isValid(destinationStorefrontId)) {
        return next(new CustomError(400, "Invalid destination storefront ID format"));
      }
    }
    sourceId = grnId;
    destinationId = isGRNToStorefront ? destinationStorefrontId : destinationWarehouseId;
    destinationType = isGRNToStorefront ? "storefront" : "warehouse";
  }
  // Handle Warehouse → Storefront transfer
  else if (transferSourceType === "Warehouse") {
    if (!sourceWarehouseId) {
      return next(
        new CustomError(
          400,
          "sourceWarehouseId is required for Warehouse → Storefront transfers"
        )
      );
    }
    if (!mongoose.Types.ObjectId.isValid(sourceWarehouseId)) {
      return next(new CustomError(400, "Invalid source warehouse ID format"));
    }
    if (!destinationStorefrontId) {
      return next(
        new CustomError(
          400,
          "destinationStorefrontId is required for Warehouse → Storefront transfers"
        )
      );
    }
    if (!mongoose.Types.ObjectId.isValid(destinationStorefrontId)) {
      return next(
        new CustomError(400, "Invalid destination storefront ID format")
      );
    }
    sourceId = sourceWarehouseId;
    destinationId = destinationStorefrontId;
    destinationType = "storefront";
  }
  // Handle Storefront → Warehouse transfer
  else if (transferSourceType === "Storefront") {
    if (!sourceStorefrontId) {
      return next(
        new CustomError(
          400,
          "sourceStorefrontId is required for Storefront → Warehouse transfers"
        )
      );
    }
    if (!mongoose.Types.ObjectId.isValid(sourceStorefrontId)) {
      return next(new CustomError(400, "Invalid source storefront ID format"));
    }
    if (!destinationWarehouseId) {
      return next(
        new CustomError(
          400,
          "destinationWarehouseId is required for Storefront → Warehouse transfers"
        )
      );
    }
    if (!mongoose.Types.ObjectId.isValid(destinationWarehouseId)) {
      return next(
        new CustomError(400, "Invalid destination warehouse ID format")
      );
    }
    sourceId = sourceStorefrontId;
    destinationId = destinationWarehouseId;
    destinationType = "warehouse";
  }

  // Validate lineItems (support both camelCase and lowercase)
  if (
    !transferLineItems ||
    !Array.isArray(transferLineItems) ||
    transferLineItems.length === 0
  ) {
    return next(
      new CustomError(
        400,
        "Line items are required and must be a non-empty array"
      )
    );
  }

  // Validate source and destination based on transfer type
  if (transferSourceType === "GRN") {
    // Fetch GRN with line items
    const grn = await GoodsRecievedNote.findById(sourceId).lean();
    if (!grn) {
      return next(new CustomError(404, "GRN not found"));
    }
    if (grn.isDeleted) {
      return next(
        new CustomError(400, "Cannot create transfer from deleted GRN")
      );
    }
    if (grn.status !== "partial" && grn.status !== "verified") {
      return next(
        new CustomError(
          400,
          `Cannot create transfer from GRN with status '${grn.status}'. Only GRNs with status 'partial' or 'verified' can have transfers created.`
        )
      );
    }
    if (!grn.lineItems || grn.lineItems.length === 0) {
      return next(new CustomError(400, "GRN has no line items"));
    }

    // Validate destination exists
    const destination = await LocationProfile.findOne({
      _id: destinationId,
      type: destinationType,
    });
    if (!destination) {
      return next(new CustomError(404, `Destination ${destinationType} not found`));
    }
    if (destination.isDeleted) {
      return next(new CustomError(400, `Cannot transfer to deleted ${destinationType}`));
    }
  } else if (transferSourceType === "Warehouse") {
    // Validate source warehouse exists
    const sourceWarehouse = await LocationProfile.findOne({
      _id: sourceId,
      type: "warehouse",
    });
    if (!sourceWarehouse) {
      return next(new CustomError(404, "Source warehouse not found"));
    }
    if (sourceWarehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot create transfer from deleted warehouse")
      );
    }

    // Validate destination storefront exists
    const storefront = await LocationProfile.findOne({
      _id: destinationId,
      type: "storefront",
    });
    if (!storefront) {
      return next(new CustomError(404, "Destination storefront not found"));
    }
    if (storefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to deleted storefront")
      );
    }
  } else if (transferSourceType === "Storefront") {
    // Validate source storefront exists
    const sourceStorefront = await LocationProfile.findOne({
      _id: sourceId,
      type: "storefront",
    });
    if (!sourceStorefront) {
      return next(new CustomError(404, "Source storefront not found"));
    }
    if (sourceStorefront.isDeleted) {
      return next(
        new CustomError(400, "Cannot create transfer from deleted storefront")
      );
    }

    // Validate destination warehouse exists
    const warehouse = await LocationProfile.findOne({
      _id: destinationId,
      type: "warehouse",
    });
    if (!warehouse) {
      return next(new CustomError(404, "Destination warehouse not found"));
    }
    if (warehouse.isDeleted) {
      return next(
        new CustomError(400, "Cannot transfer to deleted warehouse")
      );
    }
  }

  // Validate and process line items
  const validatedLineItems = [];

  for (const userItem of transferLineItems) {
    // Validate required fields
    if (!userItem.productCode) {
      return next(new CustomError(400, "Each line item must have productCode"));
    }

    if (userItem.quantity === undefined || userItem.quantity === null) {
      return next(
        new CustomError(400, "Transfer quantity is required for all line items")
      );
    }

    if (typeof userItem.quantity !== "number" || userItem.quantity <= 0) {
      return next(
        new CustomError(
          400,
          "Transfer quantity must be a positive number greater than 0"
        )
      );
    }

    // Lookup inventory by productCode
    const inventory = await Inventory.findOne({
      productCode: userItem.productCode.toUpperCase(),
    }).lean();

    if (!inventory) {
      return next(
        new CustomError(
          404,
          `Product with code '${userItem.productCode}' not found`
        )
      );
    }

    const inventoryIdValue = inventory._id;

    // Validate based on transfer type
    if (transferSourceType === "GRN") {
      // Fetch GRN again for line item validation
      const grn = await GoodsRecievedNote.findById(sourceId).lean();

      // Find corresponding GRN line item by inventoryId
      const grnLineItem = grn.lineItems.find(
        (item) => item.inventoryId.toString() === inventoryIdValue.toString()
      );

      if (!grnLineItem) {
        return next(
          new CustomError(
            400,
            `GRN does not contain product with code '${userItem.productCode}'. Please ensure the product exists in the GRN line items.`
          )
        );
      }

      // Calculate available quantity from GRN line item
      const goodQuantity = grnLineItem.goodQuantity || 0;
      const transferredQuantity = grnLineItem.transferredQuantity || 0;
      const availableQuantity = goodQuantity - transferredQuantity;

      // Validate transfer quantity doesn't exceed available quantity
      if (userItem.quantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Transfer quantity (${userItem.quantity}) exceeds available quantity (${availableQuantity}) for product '${userItem.productCode}'. Available quantity = goodQuantity (${goodQuantity}) - transferredQuantity (${transferredQuantity})`
          )
        );
      }

      // Build validated line item for GRN transfer
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        quantity: userItem.quantity,
        grnLineItemId: grnLineItem._id, // Link to GRN line item for tracking
        notes: userItem.notes || null,
      });
    } else if (transferSourceType === "Warehouse") {
      // Validate warehouse has sufficient stock
      const warehouseStock = await WarehouseStock.findOne({
        inventoryId: inventoryIdValue,
        warehouseId: sourceId,
      }).lean();

      if (!warehouseStock) {
        return next(
          new CustomError(
            404,
            `Warehouse stock not found for product '${userItem.productCode}' in source warehouse`
          )
        );
      }

      const availableQuantity = warehouseStock.quantity || 0;
      if (userItem.quantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Transfer quantity (${userItem.quantity}) exceeds available warehouse stock (${availableQuantity}) for product '${userItem.productCode}'`
          )
        );
      }

      // Build validated line item for Warehouse transfer
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        quantity: userItem.quantity,
        notes: userItem.notes || null,
        // No grnLineItemId for Warehouse → Storefront transfers
      });
    } else if (transferSourceType === "Storefront") {
      // Validate storefront has sufficient stock
      const storefrontStock = await StorefrontInventory.findOne({
        inventoryId: inventoryIdValue,
        storefrontId: sourceId,
      }).lean();

      if (!storefrontStock) {
        return next(
          new CustomError(
            404,
            `Storefront inventory not found for product '${userItem.productCode}' in source storefront`
          )
        );
      }

      const availableQuantity = storefrontStock.quantity || 0;
      if (userItem.quantity > availableQuantity) {
        return next(
          new CustomError(
            400,
            `Transfer quantity (${userItem.quantity}) exceeds available storefront stock (${availableQuantity}) for product '${userItem.productCode}'`
          )
        );
      }

      // Build validated line item for Storefront transfer
      validatedLineItems.push({
        inventoryId: inventoryIdValue,
        quantity: userItem.quantity,
        notes: userItem.notes || null,
      });
    }
  }

  // Validate and ensure inventory items exist in destination
  // This ensures we can catch errors early and provide clear error messages
  try {
    if (transferSourceType === "GRN") {
      if (destinationType === "warehouse") {
        // For GRN → Warehouse: Ensure inventory items exist in destination warehouse
        for (const lineItem of validatedLineItems) {
          const existingWarehouseStock = await WarehouseStock.findOne({
            inventoryId: lineItem.inventoryId,
            warehouseId: destinationId,
          });

          if (!existingWarehouseStock) {
            try {
              await WarehouseStock.create({
                inventoryId: lineItem.inventoryId,
                warehouseId: destinationId,
                quantity: 0,
              });
            } catch (error) {
              const inventory = await Inventory.findById(lineItem.inventoryId);
              const productCode = inventory?.productCode || lineItem.inventoryId;
              return next(
                new CustomError(
                  400,
                  `Failed to create inventory record for product '${productCode}' in destination warehouse. ${error.message}`
                )
              );
            }
          }
        }
      } else {
        // For GRN → Storefront: Ensure inventory items exist in destination storefront
        for (const lineItem of validatedLineItems) {
          const existingStorefrontInventory = await StorefrontInventory.findOne({
            inventoryId: lineItem.inventoryId,
            storefrontId: destinationId,
          });

          if (!existingStorefrontInventory) {
            try {
              await StorefrontInventory.create({
                inventoryId: lineItem.inventoryId,
                storefrontId: destinationId,
                quantity: 0,
              });
            } catch (error) {
              const inventory = await Inventory.findById(lineItem.inventoryId);
              const productCode = inventory?.productCode || lineItem.inventoryId;
              return next(
                new CustomError(
                  400,
                  `Failed to create inventory record for product '${productCode}' in destination storefront. ${error.message}`
                )
              );
            }
          }
        }
      }
    } else if (transferSourceType === "Warehouse") {
      // For Warehouse → Storefront: Ensure inventory items exist in destination storefront
      for (const lineItem of validatedLineItems) {
        const existingStorefrontInventory = await StorefrontInventory.findOne({
          inventoryId: lineItem.inventoryId,
          storefrontId: destinationId,
        });

        if (!existingStorefrontInventory) {
          // Create storefront inventory record with quantity 0 if it doesn't exist
          try {
            await StorefrontInventory.create({
              inventoryId: lineItem.inventoryId,
              storefrontId: destinationId,
              quantity: 0,
            });
          } catch (error) {
            // If creation fails, return detailed error
            const inventory = await Inventory.findById(lineItem.inventoryId);
            const productCode = inventory?.productCode || lineItem.inventoryId;
            return next(
              new CustomError(
                400,
                `Failed to create inventory record for product '${productCode}' in destination storefront. ${error.message}`
              )
            );
          }
        }
      }
    } else if (transferSourceType === "Storefront") {
      // For Storefront → Warehouse: Ensure inventory items exist in destination warehouse
      for (const lineItem of validatedLineItems) {
        const existingWarehouseStock = await WarehouseStock.findOne({
          inventoryId: lineItem.inventoryId,
          warehouseId: destinationId,
        });

        if (!existingWarehouseStock) {
          try {
            await WarehouseStock.create({
              inventoryId: lineItem.inventoryId,
              warehouseId: destinationId,
              quantity: 0,
            });
          } catch (error) {
            const inventory = await Inventory.findById(lineItem.inventoryId);
            const productCode = inventory?.productCode || lineItem.inventoryId;
            return next(
              new CustomError(
                400,
                `Failed to create inventory record for product '${productCode}' in destination warehouse. ${error.message}`
              )
            );
          }
        }
      }
    }
  } catch (error) {
    // Catch any unexpected errors during validation
    return next(
      new CustomError(
        500,
        `Error validating destination inventory: ${error.message}`
      )
    );
  }

  // Auto-generate transfer number
  const transferNumber = await Transfer.generateTransferNumber();

  // Use MongoDB transaction to ensure ACID properties
  // Transfer stock immediately when creating transfer document
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create transfer document
    const transferData = {
      transferNumber,
      sourceType: transferSourceType,
      sourceId,
      lineItems: validatedLineItems,
      transferDate: transferDate || new Date(),
      notes: notes || null,
      status: "completed", // Set to completed immediately since we transfer stock now
      transferredBy,
    };

    // Add destination based on transfer type
    if (transferSourceType === "GRN") {
      if (destinationType === "storefront") {
        transferData.destinationStorefrontId = destinationId;
      } else {
        transferData.destinationWarehouseId = destinationId;
      }
    } else if (transferSourceType === "Warehouse") {
      transferData.destinationStorefrontId = destinationId;
    } else if (transferSourceType === "Storefront") {
      transferData.destinationWarehouseId = destinationId;
    }

    // Create transfer document within transaction
    // Note: Transfer.create() with session requires array syntax for transactions
    const newTransferArray = await Transfer.create([transferData], { session });
    const transfer = newTransferArray[0];

    // Immediately transfer stock atomically (handles both GRN → Warehouse and Warehouse → Storefront)
    await transfer.updateStock(session);

    // Set receivedDate since transfer is completed
    transfer.receivedDate = new Date();
    await transfer.save({ session });

    // Commit transaction - all operations succeed or all fail
    await session.commitTransaction();
    await session.endSession();

    // Populate references for response
    if (transferSourceType === "GRN") {
      await transfer.populate("sourceId", "grnNumber status");
      if (transfer.destinationStorefrontId) {
        await transfer.populate(
          "destinationStorefrontId",
          "locationName locationCode"
        );
      } else {
        await transfer.populate(
          "destinationWarehouseId",
          "locationName locationCode"
        );
      }
    } else if (transferSourceType === "Warehouse") {
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationStorefrontId",
        "locationName locationCode"
      );
    } else if (transferSourceType === "Storefront") {
      await transfer.populate("sourceId", "locationName locationCode");
      await transfer.populate(
        "destinationWarehouseId",
        "locationName locationCode"
      );
    }
    await transfer.populate(
      "lineItems.inventoryId",
      "productName productCode SKU"
    );
    await transfer.populate("transferredBy", "name role");

    logActivity({
      admin: transferredBy,
      action: "create",
      feature: "transfer",
      description: `Created transfer ${transfer.transferNumber} (${transfer.sourceType})`,
      targetId: transfer._id,
      targetModel: "Transfer",
      metadata: { sourceType: transfer.sourceType, totalQuantity: transfer.totalQuantity },
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      message: "Transfer created and stock transferred successfully",
      data: transfer,
    });
  } catch (error) {
    // Rollback transaction on any error
    await session.abortTransaction();
    await session.endSession();
    return next(
      new CustomError(500, `Failed to create transfer: ${error.message}`)
    );
  }
});

export const getTransfers = asyncErrorHandler(async (req, res, next) => {
  const transfers = await Transfer.find()
    .populate("transferredBy", "name role")
    .populate("lineItems.inventoryId", "productName productCode SKU")
    .lean();
  if (!transfers) {
    return next(new CustomError(404, "Transfers not found"));
  }
  res.status(200).json({
    success: true,
    message: "Transfers fetched successfully",
    data: transfers,
  });
});

export const getTransferById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const transfer = await Transfer.findById(id)
    .populate("transferredBy", "name role")
    .populate("lineItems.inventoryId", "productName productCode SKU");

  if (!transfer) {
    return next(new CustomError(404, "Transfer not found"));
  }

  // Populate source and destination based on transfer type
  if (transfer.sourceType === "GRN") {
    await transfer.populate("sourceId", "grnNumber status");
    if (transfer.destinationStorefrontId) {
      await transfer.populate(
        "destinationStorefrontId",
        "locationName locationCode"
      );
    } else {
      await transfer.populate(
        "destinationWarehouseId",
        "locationName locationCode"
      );
    }
  } else if (transfer.sourceType === "Warehouse") {
    await transfer.populate("sourceId", "locationName locationCode");
    await transfer.populate(
      "destinationStorefrontId",
      "locationName locationCode"
    );
  } else if (transfer.sourceType === "Storefront") {
    await transfer.populate("sourceId", "locationName locationCode");
    await transfer.populate(
      "destinationWarehouseId",
      "locationName locationCode"
    );
  }

  res.status(200).json({
    success: true,
    message: "Transfer fetched successfully",
    data: transfer,
  });
});

export const updateTransferStatus = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return next(new CustomError(400, "Status is required"));
    }
    const validStatuses = ["pending", "in-transit", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return next(
        new CustomError(
          400,
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`
        )
      );
    }

    // Use MongoDB transaction to ensure ACID properties when completing transfer
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updatedTransfer = await Transfer.findByIdAndUpdate(
        id,
        { status },
        { new: true, session }
      );

      if (!updatedTransfer) {
        await session.abortTransaction();
        await session.endSession();
        return next(new CustomError(404, "Transfer not found"));
      }

      // When status is "completed", update stock atomically (handles both GRN → Warehouse and Warehouse → Storefront)
      if (status === "completed") {
        await updatedTransfer.updateStock(session);
      }

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      // Populate references for response based on transfer type
      if (updatedTransfer.sourceType === "GRN") {
        await updatedTransfer.populate("sourceId", "grnNumber status");
        if (updatedTransfer.destinationStorefrontId) {
          await updatedTransfer.populate(
            "destinationStorefrontId",
            "locationName locationCode"
          );
        } else {
          await updatedTransfer.populate(
            "destinationWarehouseId",
            "locationName locationCode"
          );
        }
      } else if (updatedTransfer.sourceType === "Warehouse") {
        await updatedTransfer.populate("sourceId", "locationName locationCode");
        await updatedTransfer.populate(
          "destinationStorefrontId",
          "locationName locationCode"
        );
      } else if (updatedTransfer.sourceType === "Storefront") {
        await updatedTransfer.populate("sourceId", "locationName locationCode");
        await updatedTransfer.populate(
          "destinationWarehouseId",
          "locationName locationCode"
        );
      }
      await updatedTransfer.populate(
        "lineItems.inventoryId",
        "productName productCode SKU"
      );
      await updatedTransfer.populate("transferredBy", "name role");

      logActivity({
        admin: req.user._id,
        action: "update_status",
        feature: "transfer",
        description: `Updated transfer ${updatedTransfer.transferNumber} status to ${updatedTransfer.status}`,
        targetId: updatedTransfer._id,
        targetModel: "Transfer",
        metadata: { status: updatedTransfer.status },
        ip: req.ip,
      });

      res.status(200).json({
        success: true,
        message: "Transfer status updated successfully",
        data: updatedTransfer,
      });
    } catch (error) {
      // Rollback transaction on error
      await session.abortTransaction();
      await session.endSession();
      return next(
        new CustomError(
          500,
          `Failed to update transfer status: ${error.message}`
        )
      );
    }
  }
);
