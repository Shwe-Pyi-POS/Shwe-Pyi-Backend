import express from "express";
import {
  register,
  login,
  getMe,
  updateMe,
  getAllCustomers,
  updateCustomerByAdmin,
} from "../controllers/customer.controller.js";
import { customerProtect } from "../middlewares/customerAuth.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.post("/customer/register", register);
router.post("/customer/login", login);
router.get("/customer/me", customerProtect, getMe);
router.patch("/customer/me", customerProtect, updateMe);
router.get("/customer", protect, permissionGranted("owner", "admin"), getAllCustomers);
router.patch("/customer/:id", protect, permissionGranted("owner", "admin"), updateCustomerByAdmin);

export default router;
