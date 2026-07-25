import express from "express";
import {
  createStorefrontProfile,
  getAllStorefrontProfiles,
  getStorefrontProfileById,
  updateStorefrontProfile,
} from "../controllers/storefrontProfile.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
const router = express.Router();

// Create new storefront profile
router.post(
  "/storefront-profile",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  createStorefrontProfile
);

// Get all storefront profiles
router.get(
  "/storefront-profile",
  protect,
  permissionGranted("owner", "admin", "cashier", "inventory-manager"),
  getAllStorefrontProfiles
);

// Get storefront profile by ID
router.get(
  "/storefront-profile/:id",
  protect,
  permissionGranted("owner", "admin", "cashier", "inventory-manager"),
  getStorefrontProfileById
);

// Update storefront profile
router.patch(
  "/storefront-profile/:id",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  updateStorefrontProfile
);

export default router;
