import express from "express";
import {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  softDeleteQuotation,
  markQuotationAsConverted,
} from "../controllers/quotation.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Create quotation
router.post(
  "/quotation",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  createQuotation
);

// Get all quotations
router.get(
  "/quotation",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllQuotations
);

// Get quotation by ID
router.get(
  "/quotation/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getQuotationById
);

// Update quotation
router.patch(
  "/quotation/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  updateQuotation
);

// Soft delete quotation
router.delete(
  "/quotation/:id",
  protect,
  permissionGranted("owner", "admin"),
  softDeleteQuotation
);

// Mark quotation as converted (order created via POST /order by frontend)
router.patch(
  "/quotation/:id/convert-to-order",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  markQuotationAsConverted
);

export default router;
