import express from "express";
import {
  getPurchaseReport,
  getPurchaseProductReport,
  getPurchaseSupplierReport,
} from "../controllers/purchaseReport.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Overall PO report with summary, status breakdown, and paginated details
router.get(
  "/purchase-report",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseReport
);

// Product-level purchase report
router.get(
  "/purchase-report/products",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseProductReport
);

// Supplier-level purchase report
router.get(
  "/purchase-report/suppliers",
  protect,
  permissionGranted("owner", "admin"),
  getPurchaseSupplierReport
);

export default router;
