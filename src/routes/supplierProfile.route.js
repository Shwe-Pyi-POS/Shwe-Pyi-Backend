import express from "express";
import {
  createSupplierProfile,
  getAllSupplierProfiles,
  getSupplierProfileById,
  updateSupplierProfile,
  softDeleteSupplierProfile,
  restoreSupplierProfile,
  deleteSupplierProfile,
} from "../controllers/supplier.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
const router = express.Router();

router.post(
  "/supplier-profile",
  protect,
  permissionGranted("owner", "admin"),
  createSupplierProfile
);
router.get(
  "/supplier-profile",
  protect,
  permissionGranted("owner", "admin"),
  getAllSupplierProfiles
);
router.get(
  "/supplier-profile/:id",
  protect,
  permissionGranted("owner", "admin"),
  getSupplierProfileById
);
router.patch(
  "/supplier-profile/:id",
  protect,
  permissionGranted("owner"),
  updateSupplierProfile
);
router.patch(
  "/supplier-profile/:id/soft-delete",
  protect,
  permissionGranted("owner"),
  softDeleteSupplierProfile
);
router.patch(
  "/supplier-profile/:id/restore",
  protect,
  permissionGranted("owner"),
  restoreSupplierProfile
);
router.delete(
  "/supplier-profile/:id",
  protect,
  permissionGranted("owner"),
  deleteSupplierProfile
);
export default router;
