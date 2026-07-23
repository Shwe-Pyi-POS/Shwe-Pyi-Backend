import express from "express";
import {
  createWarehouseProfile,
  getAllWarehouseProfiles,
  getWarehouseProfileById,
  updateWarehouseProfile,
} from "../controllers/warehouseProfile.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
const router = express.Router();

// Create new warehouse profile
router.post(
  "/warehouse-profile",
  protect,
  permissionGranted("owner", "admin"),
  createWarehouseProfile
);

// Get all warehouse profiles
router.get(
  "/warehouse-profile",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllWarehouseProfiles
);

// Get warehouse profile by ID
router.get(
  "/warehouse-profile/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getWarehouseProfileById
);

// Update warehouse profile
router.patch(
  "/warehouse-profile/:id",
  protect,
  permissionGranted("owner"),
  updateWarehouseProfile
);

export default router;
