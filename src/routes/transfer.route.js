import express from "express";
import {
  createTransfer,
  getTransfers,
  getTransferById,
  updateTransferStatus,
} from "../controllers/transfer.controller.js";

import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
const router = express.Router();

router.post(
  "/transfer",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  createTransfer
);
router.get(
  "/transfer",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  getTransfers
);
router.get(
  "/transfer/:id",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  getTransferById
);
router.patch(
  "/transfer/:id",
  protect,
  permissionGranted("owner", "admin", "inventory-manager"),
  updateTransferStatus
);
export default router;
