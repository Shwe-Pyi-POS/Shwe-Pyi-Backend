import mongoose from "mongoose";
import Inventory from "../models/inventory.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";
import XLSX from "xlsx";
import multer from "multer";
import {
  uploadToR2,
  deleteFromR2,
  generateR2Key,
} from "../configs/cloudflareR2.config.js";

// Create new inventory item (multipart: fields + images)
export const createInventory = asyncErrorHandler(async (req, res, next) => {
  const inventoryData = { ...req.body };

  // Convert comma-separated tags string to array (from FormData)
  if (typeof inventoryData.tags === "string") {
    inventoryData.tags = inventoryData.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // Parse wholesalePrices JSON string from FormData
  if (typeof inventoryData.wholesalePrices === "string") {
    try {
      inventoryData.wholesalePrices = JSON.parse(inventoryData.wholesalePrices);
    } catch {
      return next(new CustomError(400, "Invalid wholesalePrices format. Must be a valid JSON array."));
    }
  }

  // Parse uomConversions JSON string from FormData
  if (typeof inventoryData.uomConversions === "string") {
    try {
      inventoryData.uomConversions = JSON.parse(inventoryData.uomConversions);
    } catch {
      return next(new CustomError(400, "Invalid uomConversions format. Must be a valid JSON array."));
    }
  }

  // Remove empty string fields from FormData (no file selected, empty text field, etc.)
  Object.keys(inventoryData).forEach((key) => {
    if (inventoryData[key] === "") delete inventoryData[key];
  });

  // Check if productCode already exists
  if (inventoryData.productCode) {
    const existingProduct = await Inventory.findOne({
      productCode: inventoryData.productCode.toUpperCase(),
    });
    if (existingProduct) {
      return next(new CustomError(400, "Product code already exists"));
    }
  }

  // Check if SKU already exists
  if (inventoryData.SKU) {
    const existingSKU = await Inventory.findOne({
      SKU: inventoryData.SKU.toUpperCase(),
    });
    if (existingSKU) {
      return next(new CustomError(400, "SKU already exists"));
    }
  }

  // Check if barcode already exists (if provided)
  if (inventoryData.barcode) {
    const existingBarcode = await Inventory.findOne({
      barcode: inventoryData.barcode,
    });
    if (existingBarcode) {
      return next(new CustomError(400, "Barcode already exists"));
    }
  }

  // Check if saleCode already exists (if provided)
  if (inventoryData.saleCode) {
    const existingSaleCode = await Inventory.findOne({
      saleCode: inventoryData.saleCode.toUpperCase(),
    });
    if (existingSaleCode) {
      return next(new CustomError(400, "Sale code already exists"));
    }
  }

  // Upload images to R2 FIRST (before saving to DB)
  // If upload fails, product won't be saved — prevents partial data
  let uploadedImages = [];
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const key = generateR2Key(file.originalname, "inventory");
      const url = await uploadToR2(file, key);
      uploadedImages.push({
        url,
        key,
        isPrimary: uploadedImages.length === 0,
      });
    }
  }

  inventoryData.images = uploadedImages;
  const newInventory = await Inventory.create(inventoryData);

  logActivity({
    admin: req.user?._id,
    action: "create",
    feature: "inventory",
    description: `Created inventory item ${newInventory.productCode} - ${newInventory.productName}`,
    targetId: newInventory._id,
    targetModel: "Inventory",
    metadata: { productCode: newInventory.productCode, sellingPrice: newInventory.sellingPrice },
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: "Inventory item created successfully",
    data: newInventory,
  });
});

// Get all inventory items
export const getAllInventory = asyncErrorHandler(async (req, res, next) => {
  const {
    page,
    limit,
    category,
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  // Build query
  const query = {};

  if (category) {
    query.category = category;
  }

  if (status) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { productName: { $regex: search, $options: "i" } },
      { productCode: { $regex: search, $options: "i" } },
    ];
  }

  // Sort
  const sort = {};
  sort[sortBy] = sortOrder === "asc" ? 1 : -1;

  // Build query chain
  let queryChain = Inventory.find(query).sort(sort);

  // Apply pagination only if page or limit is provided
  const usePagination = page !== undefined || limit !== undefined;
  let paginationInfo = null;

  if (usePagination) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    queryChain = queryChain.skip(skip).limit(limitNum);

    // Get total count for pagination
    const total = await Inventory.countDocuments(query);

    paginationInfo = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    };
  }

  // Execute query
  const inventory = await queryChain;

  const response = {
    success: true,
    message: "Inventory items retrieved successfully",
    data: inventory,
  };

  // Only include pagination info if pagination was applied
  if (paginationInfo) {
    response.pagination = paginationInfo;
  }

  res.status(200).json(response);
});

// Get inventory item by ID
export const getInventoryById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid inventory ID format"));
  }

  const inventory = await Inventory.findById(id);

  if (!inventory) {
    return next(new CustomError(404, "Inventory item not found"));
  }

  // Get stock availability for all warehouses
  const warehouseStocks = await WarehouseStock.find({
    inventoryId: id,
  })
    .populate(
      "warehouseId",
      "locationName locationCode locationAddress type status",
    )
    .select("warehouseId quantity lastUpdated");

  // Get stock availability for all storefronts
  const storefrontStocks = await StorefrontInventory.find({
    inventoryId: id,
  })
    .populate(
      "storefrontId",
      "locationName locationCode locationAddress type status",
    )
    .select("storefrontId quantity lastUpdated");

  // Format warehouse stock data - filter out null warehouseId (deleted locations)
  const warehouseStockAvailability = warehouseStocks
    .filter(
      (stock) => stock.warehouseId !== null && stock.warehouseId !== undefined,
    )
    .map((stock) => ({
      locationId: stock.warehouseId._id,
      locationName: stock.warehouseId.locationName,
      locationCode: stock.warehouseId.locationCode,
      locationAddress: stock.warehouseId.locationAddress,
      locationType: stock.warehouseId.type,
      status: stock.warehouseId.status,
      quantity: stock.quantity,
      lastUpdated: stock.lastUpdated,
    }));

  // Format storefront stock data - filter out null storefrontId (deleted locations)
  const storefrontStockAvailability = storefrontStocks
    .filter(
      (stock) =>
        stock.storefrontId !== null && stock.storefrontId !== undefined,
    )
    .map((stock) => ({
      locationId: stock.storefrontId._id,
      locationName: stock.storefrontId.locationName,
      locationCode: stock.storefrontId.locationCode,
      locationAddress: stock.storefrontId.locationAddress,
      locationType: stock.storefrontId.type,
      status: stock.storefrontId.status,
      quantity: stock.quantity,
      lastUpdated: stock.lastUpdated,
    }));

  // Calculate total quantities - only count stocks with valid locations
  const totalWarehouseQuantity = warehouseStocks
    .filter(
      (stock) => stock.warehouseId !== null && stock.warehouseId !== undefined,
    )
    .reduce((sum, stock) => sum + (stock.quantity || 0), 0);
  const totalStorefrontQuantity = storefrontStocks
    .filter(
      (stock) =>
        stock.storefrontId !== null && stock.storefrontId !== undefined,
    )
    .reduce((sum, stock) => sum + (stock.quantity || 0), 0);
  const totalQuantity = totalWarehouseQuantity + totalStorefrontQuantity;

  res.status(200).json({
    success: true,
    message: "Inventory item retrieved successfully",
    data: {
      ...inventory.toObject(),
      stockAvailability: {
        warehouses: {
          count: warehouseStockAvailability.length,
          locations: warehouseStockAvailability,
          totalQuantity: totalWarehouseQuantity,
        },
        storefronts: {
          count: storefrontStockAvailability.length,
          locations: storefrontStockAvailability,
          totalQuantity: totalStorefrontQuantity,
        },
        totalQuantity: totalQuantity,
      },
    },
  });
});

// Update inventory metadata
export const updateInventory = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const updateData = req.body;

  // Validate MongoDB ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid inventory ID format"));
  }

  // Check if inventory exists
  const existingInventory = await Inventory.findById(id);
  if (!existingInventory) {
    return next(new CustomError(404, "Inventory item not found"));
  }

  // Check for uniqueness conflicts if unique fields are being updated
  // productCode is required and unique, so always check if provided
  if (updateData.productCode !== undefined) {
    const trimmedProductCode = String(updateData.productCode).trim();
    if (!trimmedProductCode) {
      return next(new CustomError(400, "Product code cannot be empty"));
    }
    const existingProduct = await Inventory.findOne({
      productCode: trimmedProductCode.toUpperCase(),
      _id: { $ne: id },
    });
    if (existingProduct) {
      return next(new CustomError(400, "Product code already exists"));
    }
  }

  // SKU is optional but unique when provided (sparse unique)
  if (updateData.SKU !== undefined) {
    const trimmedSKU = String(updateData.SKU).trim();
    // Allow empty string/null for sparse unique fields
    if (trimmedSKU) {
      const existingSKU = await Inventory.findOne({
        SKU: trimmedSKU.toUpperCase(),
        _id: { $ne: id },
      });
      if (existingSKU) {
        return next(new CustomError(400, "SKU already exists"));
      }
    }
  }

  // barcode is optional but unique when provided (sparse unique)
  if (updateData.barcode !== undefined) {
    const trimmedBarcode = String(updateData.barcode).trim();
    // Allow empty string/null for sparse unique fields
    if (trimmedBarcode) {
      const existingBarcode = await Inventory.findOne({
        barcode: trimmedBarcode,
        _id: { $ne: id },
      });
      if (existingBarcode) {
        return next(new CustomError(400, "Barcode already exists"));
      }
    }
  }

  // saleCode is optional but unique when provided (sparse unique)
  if (updateData.saleCode !== undefined) {
    const trimmedSaleCode = String(updateData.saleCode).trim();
    // Allow empty string/null for sparse unique fields
    if (trimmedSaleCode) {
      const existingSaleCode = await Inventory.findOne({
        saleCode: trimmedSaleCode.toUpperCase(),
        _id: { $ne: id },
      });
      if (existingSaleCode) {
        return next(new CustomError(400, "Sale code already exists"));
      }
    }
  }

  // Validate sellingPrice >= buyingPrice
  // Merge updateData with existing data to get the final values
  const finalBuyingPrice =
    updateData.buyingPrice !== undefined
      ? updateData.buyingPrice
      : existingInventory.buyingPrice;
  const finalSellingPrice =
    updateData.sellingPrice !== undefined
      ? updateData.sellingPrice
      : existingInventory.sellingPrice;

  if (finalSellingPrice < finalBuyingPrice) {
    return next(
      new CustomError(
        400,
        `Selling price (${finalSellingPrice}) should be greater than or equal to buying price (${finalBuyingPrice})`,
      ),
    );
  }

  // Apply updates to the existing document and save
  // This ensures validators have access to the complete merged document
  Object.keys(updateData).forEach((key) => {
    if (updateData[key] !== undefined) {
      existingInventory[key] = updateData[key];
    }
  });

  // Save the updated inventory (this will run all validators with the complete document)
  const updatedInventory = await existingInventory.save();

  logActivity({
    admin: req.user?._id,
    action: "update",
    feature: "inventory",
    description: `Updated inventory item ${updatedInventory.productCode} - ${updatedInventory.productName}`,
    targetId: updatedInventory._id,
    targetModel: "Inventory",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Inventory item updated successfully",
    data: updatedInventory,
  });
});

// Bulk import inventory from Excel file
export const importInventoryFromExcel = asyncErrorHandler(
  async (req, res, next) => {
    if (!req.file) {
      return next(new CustomError(400, "Please upload an Excel file"));
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
      failed: 0,
      errors: [],
      created: [],
    };

    const validStatuses = ["active", "inactive", "discontinued"];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      try {
        const productName =
          row.productName || row.product_name || row["Product Name"];
        const productCode =
          row.productCode || row.product_code || row["Product Code"];
        const category = row.category || row["Category"];
        const buyingPrice =
          row.buyingPrice || row.buying_price || row["Buying Price"];
        const sellingPrice =
          row.sellingPrice || row.selling_price || row["Selling Price"];

        if (!productName) {
          throw new Error("Product name is required");
        }
        if (!productCode) {
          throw new Error("Product code is required");
        }
        if (!category) {
          throw new Error("Category is required");
        }
        if (
          buyingPrice === undefined ||
          buyingPrice === null ||
          buyingPrice === ""
        ) {
          throw new Error("Buying price is required");
        }
        if (
          sellingPrice === undefined ||
          sellingPrice === null ||
          sellingPrice === ""
        ) {
          throw new Error("Selling price is required");
        }

        const numBuyingPrice = Number(buyingPrice);
        const numSellingPrice = Number(sellingPrice);

        if (isNaN(numBuyingPrice) || numBuyingPrice < 0) {
          throw new Error("Buying price must be a valid non-negative number");
        }
        if (isNaN(numSellingPrice) || numSellingPrice < 0) {
          throw new Error("Selling price must be a valid non-negative number");
        }
        if (numSellingPrice < numBuyingPrice) {
          throw new Error("Selling price must be >= buying price");
        }

        const existingProduct = await Inventory.findOne({
          productCode: String(productCode).toUpperCase(),
        });
        if (existingProduct) {
          throw new Error(`Product code '${productCode}' already exists`);
        }

        const SKU = row.SKU || row.sku;
        if (SKU) {
          const existingSKU = await Inventory.findOne({
            SKU: String(SKU).toUpperCase(),
          });
          if (existingSKU) {
            throw new Error(`SKU '${SKU}' already exists`);
          }
        }

        const barcode = row.barcode || row["Barcode"];
        if (barcode) {
          const existingBarcode = await Inventory.findOne({
            barcode: String(barcode),
          });
          if (existingBarcode) {
            throw new Error(`Barcode '${barcode}' already exists`);
          }
        }

        const saleCode = row.saleCode || row.sale_code || row["Sale Code"];
        if (saleCode) {
          const existingSaleCode = await Inventory.findOne({
            saleCode: String(saleCode).toUpperCase(),
          });
          if (existingSaleCode) {
            throw new Error(`Sale code '${saleCode}' already exists`);
          }
        }

        const unitOfMeasure =
          row.unitOfMeasure ||
          row.unit_of_measure ||
          row["Unit of Measure"] ||
          "piece";

        const status = row.status || row["Status"] || "active";
        if (!validStatuses.includes(String(status).toLowerCase())) {
          throw new Error(`Invalid status: '${status}'`);
        }

        const taxRate = row.taxRate || row.tax_rate || row["Tax Rate"] || 0;
        const numTaxRate = Number(taxRate);
        if (isNaN(numTaxRate) || numTaxRate < 0 || numTaxRate > 100) {
          throw new Error("Tax rate must be between 0 and 100");
        }

        const inventoryData = {
          productName: String(productName).trim(),
          productCode: String(productCode).trim().toUpperCase(),
          saleCode: saleCode
            ? String(saleCode).trim().toUpperCase()
            : undefined,
          SKU: SKU ? String(SKU).trim().toUpperCase() : undefined,
          barcode: barcode ? String(barcode).trim() : undefined,
          category: String(category).trim(),
          subCategory:
            row.subCategory ||
            row.sub_category ||
            row["Sub Category"] ||
            "Unknown",
          brand: row.brand || row["Brand"] || "Unknown",
          description:
            row.description || row["Description"] || "No description available",
          buyingPrice: numBuyingPrice,
          sellingPrice: numSellingPrice,
          unitOfMeasure: String(unitOfMeasure).toLowerCase(),
          reorderPoint: Number(
            row.reorderPoint || row.reorder_point || row["Reorder Point"] || 0,
          ),
          reorderQuantity: Number(
            row.reorderQuantity ||
              row.reorder_quantity ||
              row["Reorder Quantity"] ||
              0,
          ),
          taxRate: numTaxRate,
          status: String(status).toLowerCase(),
          tags: row.tags
            ? String(row.tags)
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
          note: row.note || row["Note"] || "",
        };

        const newItem = await Inventory.create(inventoryData);
        results.success++;
        results.created.push({
          row: rowNum,
          id: newItem._id,
          productCode: newItem.productCode,
          productName: newItem.productName,
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
      message: `Import completed: ${results.success} created, ${results.failed} failed out of ${results.total}`,
      data: results,
    });
  },
);

// Get all unique categories from inventory
export const getAllCategories = asyncErrorHandler(async (req, res, next) => {
  const categories = await Inventory.distinct("category");

  res.status(200).json({
    success: true,
    message: "Categories retrieved successfully",
    data: categories.filter(Boolean), // Remove any null or undefined values
  });
});

// --- Inventory Image Management ---

// Multer config for inventory images (max 5, each up to 5MB)
export const inventoryMulter = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        new CustomError(400, "Only JPEG, PNG, and WebP images are allowed"),
        false
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Upload images to inventory item (max 5 total)
export const uploadInventoryImages = [
  inventoryMulter.array("images", 5),
  asyncErrorHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid inventory ID format"));
    }

    if (!req.files || req.files.length === 0) {
      return next(new CustomError(400, "Please upload at least one image"));
    }

    const inventory = await Inventory.findById(id);
    if (!inventory) {
      return next(new CustomError(404, "Inventory item not found"));
    }

    const currentCount = inventory.images?.length || 0;
    const incomingCount = req.files.length;
    if (currentCount + incomingCount > 5) {
      return next(
        new CustomError(
          400,
          `Cannot add ${incomingCount} images. Product already has ${currentCount} image(s). Maximum total is 5.`
        )
      );
    }

    const uploadedImages = [];

    for (const file of req.files) {
      const key = generateR2Key(file.originalname, "inventory");
      const url = await uploadToR2(file, key);
      uploadedImages.push({
        url,
        key,
        isPrimary: currentCount === 0 && uploadedImages.length === 0,
      });
    }

    inventory.images.push(...uploadedImages);
    await inventory.save();

    res.status(200).json({
      success: true,
      message: `${uploadedImages.length} image(s) uploaded successfully`,
      data: { images: uploadedImages, totalImages: inventory.images.length },
    });
  }),
];

// Delete a single image from inventory item
export const deleteInventoryImage = asyncErrorHandler(
  async (req, res, next) => {
    const { id, imageId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(id) ||
      !mongoose.Types.ObjectId.isValid(imageId)
    ) {
      return next(new CustomError(400, "Invalid ID format"));
    }

    const inventory = await Inventory.findById(id);
    if (!inventory) {
      return next(new CustomError(404, "Inventory item not found"));
    }

    const imageIndex = inventory.images.findIndex(
      (img) => img._id.toString() === imageId
    );
    if (imageIndex === -1) {
      return next(new CustomError(404, "Image not found"));
    }

    const removedImage = inventory.images[imageIndex];
    const wasPrimary = removedImage.isPrimary;

    await deleteFromR2(removedImage.key);

    inventory.images.splice(imageIndex, 1);

    if (wasPrimary && inventory.images.length > 0) {
      inventory.images[0].isPrimary = true;
    }

    await inventory.save();

    res.status(200).json({
      success: true,
      message: "Image deleted successfully",
      data: { totalImages: inventory.images.length },
    });
  }
);

// Set primary image for inventory item
export const setPrimaryInventoryImage = asyncErrorHandler(
  async (req, res, next) => {
    const { id, imageId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(id) ||
      !mongoose.Types.ObjectId.isValid(imageId)
    ) {
      return next(new CustomError(400, "Invalid ID format"));
    }

    const inventory = await Inventory.findById(id);
    if (!inventory) {
      return next(new CustomError(404, "Inventory item not found"));
    }

    const imageExists = inventory.images.some(
      (img) => img._id.toString() === imageId
    );
    if (!imageExists) {
      return next(new CustomError(404, "Image not found"));
    }

    inventory.images.forEach((img) => {
      img.isPrimary = img._id.toString() === imageId;
    });

    await inventory.save();

    res.status(200).json({
      success: true,
      message: "Primary image updated successfully",
      data: { images: inventory.images },
    });
  }
);
