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
  permissionGranted("owner", "admin"),
  createStorefrontProfile
);

// Get all storefront profiles
router.get(
  "/storefront-profile",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllStorefrontProfiles
);

// Get storefront profile by ID
router.get(
  "/storefront-profile/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getStorefrontProfileById
);

// Update storefront profile
router.patch(
  "/storefront-profile/:id",
  protect,
  permissionGranted("owner"),
  updateStorefrontProfile
);

export default router;
