import express from "express";
import {
  getSaleReportByStorefrontId,
  getPaymentMethodReportByStorefrontId,
  getCreditSaleReportByStorefrontId,
  getProductSalesReportByStorefrontId,
  getCreditPersonaProductReport,
  getSaleProductsAnalyticsByCreditPerson,
} from "../controllers/saleReport.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Sale report for storefront or all storefronts
// Use ?storefrontId=<id> for specific storefront, omit for all storefronts
router.get(
  "/sale-report",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getSaleReportByStorefrontId
);

// Payment method breakdown report for storefront or all storefronts (paid orders only)
// Use ?storefrontId=<id> for specific storefront, omit for all storefronts
router.get(
  "/sale-report/paid-orders",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getPaymentMethodReportByStorefrontId
);

// Credit sale report with credit records breakdown for storefront or all storefronts
// Use ?storefrontId=<id> for specific storefront, omit for all storefronts
router.get(
  "/sale-report/credit-orders",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditSaleReportByStorefrontId
);

// Product/stock sales statistics report for storefront or all storefronts
// Use ?storefrontId=<id> for specific storefront, omit for all storefronts
router.get(
  "/sale-report/products",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getProductSalesReportByStorefrontId
);

// Credit persona product report
router.get(
  "/sale-report/credit-persona-products",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditPersonaProductReport
);

// Sale products analytics by credit person - shows for each product, which credit persons bought it and their quantities
// Use ?storefrontId=<id> for specific storefront, omit for all storefronts
// Use ?inventoryId=<id> to filter by specific product, omit for all products
router.get(
  "/sale-report/products-by-credit-person",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getSaleProductsAnalyticsByCreditPerson
);

export default router;
