import express from "express";
import {
  createCreditPayment,
  getCreditRecordsByOrderId,
  getAllCreditRecords,
  getCreditRecordById,
  getCreditRecordsByCreditPersonId,
  hardDeleteCreditRecord,
} from "../controllers/creditRecord.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Create credit payment for an order
router.post(
  "/credit-record",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  createCreditPayment
);

// Get all credit records (with optional filtering)
router.get(
  "/credit-record",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllCreditRecords
);

// Get credit record by ID
router.get(
  "/credit-record/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditRecordById
);

// Get all credit records for a specific order
router.get(
  "/order/:orderId/credit-records",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditRecordsByOrderId
);

// Get all credit records for a specific credit person
router.get(
  "/credit-persona/:creditPersonId/credit-records",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditRecordsByCreditPersonId
);

// Hard delete credit record
router.delete(
  "/credit-record/:id",
  protect,
  permissionGranted("owner"),
  hardDeleteCreditRecord
);

export default router;
