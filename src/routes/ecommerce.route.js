import express from "express";
import {
  getProducts,
  createOrder,
  getMyOrders,
  getMyOrderById,
  getAllEcommerceOrders,
  getEcommerceOrderById,
  updateEcommerceOrderStatus,
  updateEcommerceOrderProducts,
} from "../controllers/ecommerce.controller.js";
import { customerProtect } from "../middlewares/customerAuth.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.get("/ecommerce/products", getProducts);
router.post("/ecommerce/order", customerProtect, createOrder);
router.get("/ecommerce/orders", customerProtect, getMyOrders);
router.get("/ecommerce/orders/:id", customerProtect, getMyOrderById);

router.get("/ecommerce/admin/orders", protect, permissionGranted("owner", "admin"), getAllEcommerceOrders);
router.get("/ecommerce/admin/orders/:id", protect, permissionGranted("owner", "admin"), getEcommerceOrderById);
router.patch("/ecommerce/admin/orders/:id/status", protect, permissionGranted("owner", "admin"), updateEcommerceOrderStatus);
router.patch("/ecommerce/admin/orders/:id/products", protect, permissionGranted("owner", "admin"), updateEcommerceOrderProducts);

export default router;
