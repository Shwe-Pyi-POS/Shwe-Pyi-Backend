import { Router } from "express";
import {
  createCreditPerson,
  getAllCreditPersons,
  getCreditPersonById,
  updateCreditPerson,
  getCreditPersonOrderSummary,
} from "../controllers/creditPersona.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = Router();

router.post(
  "/credit-persona",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  createCreditPerson
);
router.get(
  "/credit-persona",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllCreditPersons
);
router.get(
  "/credit-persona/:id",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditPersonById
);
router.patch(
  "/credit-persona/:id",
  protect,
  permissionGranted("owner"),
  updateCreditPerson
);
router.get(
  "/credit-persona/:id/order-summary",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditPersonOrderSummary
);
export default router;
