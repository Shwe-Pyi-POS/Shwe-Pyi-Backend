import express from "express";
import {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  updatePurchaseStatus,
  softDeletePurchase,
  restorePurchase,
} from "../controllers/purchase.controller.js";
import {
  protect,
  permissionGranted,
} from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.post(
  "/purchase",
  protect,
  permissionGranted("owner", "admin"),
  createPurchase
);
router.get(
  "/purchase",
  protect,
  permissionGranted("owner", "admin"),
  getAllPurchases
);
router.get(
  "/purchase/:id",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseById
);
router.patch(
  "/purchase/:id/status",
  protect,
  permissionGranted("owner", "admin"),
  updatePurchaseStatus
);
router.patch(
  "/purchase/:id/soft-delete",
  protect,
  permissionGranted("owner"),
  softDeletePurchase
);
router.patch(
  "/purchase/:id/restore",
  protect,
  permissionGranted("owner"),
  restorePurchase
);
export default router;
