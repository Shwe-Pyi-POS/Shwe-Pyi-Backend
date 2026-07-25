import express from "express";
import multer from "multer";
import {
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  importInventoryFromExcel,
  getAllCategories,
  inventoryMulter,
  uploadInventoryImages,
  deleteInventoryImage,
  setPrimaryInventoryImage,
} from "../controllers/inventory.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls") ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls, .csv) are allowed"), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// Bulk import inventory from Excel
router.post(
  "/inventory/import-excel",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  upload.single("file"),
  importInventoryFromExcel,
);

// Get all unique categories
router.get(
  "/inventory/categories",
  protect,
  permissionGranted("owner", "admin", "cashier", "inventory-manager"),
  getAllCategories,
);

// Create new inventory item (multipart: fields + up to 5 images)
router.post(
  "/inventory",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  inventoryMulter.array("images", 5),
  createInventory,
);

// Get all inventory items
router.get(
  "/inventory",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  getAllInventory,
);

// Get inventory item by ID
router.get(
  "/inventory/:id",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  getInventoryById,
);

// Update inventory metadata
router.patch(
  "/inventory/:id",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  updateInventory,
);

// Upload images to inventory item (max 5)
router.post(
  "/inventory/:id/images",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  uploadInventoryImages,
);

// Delete a single image from inventory item
router.delete(
  "/inventory/:id/images/:imageId",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  deleteInventoryImage,
);

// Set primary image for inventory item
router.patch(
  "/inventory/:id/images/:imageId/primary",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  setPrimaryInventoryImage,
);

export default router;
