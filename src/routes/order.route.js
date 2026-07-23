import express from "express";
import {
  createOrder,
  getOrders,
  getOrdersByStorefrontId,
  getAllOrders,
  updateOrderCreditPersonId,
  updateOrderPaidAmount,
  updateOrderDueDate,
  updateOrderTransportFee,
  addOrderItems,
  removeOrderItems,
  hardDeleteOrder,
} from "../controllers/order.controller.js";

const router = express.Router();
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

// Create new order
router.post(
  "/order",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  createOrder
);
router.get(
  "/order",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllOrders
);
router.get(
  "/order/:orderId",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getOrders
);
router.get(
  "/order/storefront/:storefrontId",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getOrdersByStorefrontId
);

// Update/add credit person ID to an order
router.patch(
  "/order/:orderId/credit-person",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  updateOrderCreditPersonId
);

// Update order paid amount
router.patch(
  "/order/:orderId/paid-amount",
  protect,
  permissionGranted("owner"),
  updateOrderPaidAmount
);

// Update order due date
router.patch(
  "/order/:orderId/due-date",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  updateOrderDueDate
);

// Update order transport fee
router.patch(
  "/order/:orderId/transport-fee",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  updateOrderTransportFee
);

// Add order items to existing order
router.patch(
  "/order/:orderId/items/add",
  protect,
  permissionGranted("owner"),
  addOrderItems
);

// Remove order items from existing order
router.patch(
  "/order/:orderId/items/remove",
  protect,
  permissionGranted("owner"),
  removeOrderItems
);

// Hard delete order
router.delete("/order/:orderId", hardDeleteOrder);

export default router;
