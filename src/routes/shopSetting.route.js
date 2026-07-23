import express from "express";
import {
  createOrUpdateShopSetting,
  uploadShopLogo,
  getCurrentShopSettings,
  deleteShopLogo,
  getAllShopSettings,
  upload,
} from "../controllers/shopSetting.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Create or update shop settings
router.post(
  "/shop-settings",
  protect,
  permissionGranted("owner", "admin"),
  createOrUpdateShopSetting
);

// Upload shop logo
router.post(
  "/shop-settings/logo",
  protect,
  permissionGranted("owner", "admin"),
  upload.single("logo"),
  uploadShopLogo
);

// Get current shop settings
router.get(
  "/shop-settings",
  getCurrentShopSettings
);

// Delete shop logo
router.delete(
  "/shop-settings/logo",
  protect,
  permissionGranted("owner", "admin"),
  deleteShopLogo
);

// Get all shop settings history (for audit trail)
router.get(
  "/shop-settings/history",
  protect,
  permissionGranted("owner", "admin"),
  getAllShopSettings
);

export default router;
