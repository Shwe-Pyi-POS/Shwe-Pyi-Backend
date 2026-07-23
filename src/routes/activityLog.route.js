import express from "express";
import {
  getActivityLogs,
  getActivityLogById,
} from "../controllers/activityLog.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.get(
  "/activity-log",
  protect,
  permissionGranted("owner", "admin"),
  getActivityLogs
);

router.get(
  "/activity-log/:id",
  protect,
  permissionGranted("owner", "admin"),
  getActivityLogById
);

export default router;
