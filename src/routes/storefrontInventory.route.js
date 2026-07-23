import express from "express";
import multer from "multer";
import {
  createStorefrontInventory,
  getAllStorefrontInventory,
  getStorefrontInventoryById,
  updateStorefrontInventoryQuantity,
  importStorefrontInventoryFromExcel,
} from "../controllers/storefrontInventory.controller.js";
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
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Bulk add quantities from Excel (storefrontId via API, not in Excel)
router.post(
  "/storefront-inventory/import-excel",
  protect,
  permissionGranted("owner", "admin"),
  upload.single("file"),
  importStorefrontInventoryFromExcel,
);

// Create new storefront inventory
router.post(
  "/storefront-inventory",
  protect,
  permissionGranted("owner", "admin"),
  createStorefrontInventory
);

// Get all storefront inventory (with filtering, pagination, sorting)
router.get(
  "/storefront-inventory",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllStorefrontInventory
);

// Get storefront inventory by ID
router.get(
  "/storefront-inventory/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getStorefrontInventoryById
);

// Update storefront inventory quantity
router.patch(
  "/storefront-inventory/:id/quantity",
  protect,
  permissionGranted("owner"),
  updateStorefrontInventoryQuantity
);

export default router;
