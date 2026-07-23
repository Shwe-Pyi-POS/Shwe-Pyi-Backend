import express from "express";
import { chatWithBot, getChatHistory, clearChatHistory } from "../controllers/chatbot.controller.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.post("/chatbot", protect, permissionGranted("owner"), chatWithBot);
router.get("/chatbot", protect, permissionGranted("owner"), getChatHistory);
router.delete("/chatbot", protect, permissionGranted("owner"), clearChatHistory);

export default router;
