import ChatSession from "../models/chatSession.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { askGemini } from "../services/openrouter.service.js";

// Remove any non-Myanmar text (Arabic, Persian, English) from AI reply
function cleanReply(text) {
  if (!text) return text;
  // Remove Arabic/Persian characters (U+0600–U+06FF, U+0750–U+077F, U+08A0–U+08FF)
  let cleaned = text.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, "");
  // Replace multiple spaces with single space
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  // Add newline before numbered list items (e.g. " 1. " → "\n1. ") for markdown rendering
  cleaned = cleaned.replace(/\s+(\d+\.\s+)/g, "\n$1");
  // Collapse multiple newlines
  cleaned = cleaned.replace(/\n{2,}/g, "\n");
  // If after cleaning the string is empty or only symbols, use fallback
  if (!cleaned || cleaned.length < 3) {
    return "ဖြေဆိုရာတွင်အမှားရှိခဲ့ပါတယ်။ ကျေးဇူးပြု၍ ပြန်လည်မေးမြန်းပေးပါ။";
  }
  return cleaned;
}

export const chatWithBot = asyncErrorHandler(async (req, res, next) => {
  const { message } = req.body;
  const adminId = req.user._id;
  const jwtToken = req.headers.authorization;

  if (!message || !message.trim()) {
    return next(new CustomError(400, "Message is required"));
  }

  if (!jwtToken) {
    return next(new CustomError(401, "Authorization header required"));
  }

  let session = await ChatSession.findOne({ admin: adminId });
  if (!session) {
    session = await ChatSession.create({ admin: adminId, messages: [] });
  }

  session.messages.push({ role: "user", text: message.trim() });

  let replyText;
  try {
    replyText = await askGemini(session.messages, jwtToken);
  } catch (err) {
    console.error("Chatbot API error:", err.message);
    session.messages = [{ role: "user", text: message.trim() }];
    try {
      replyText = await askGemini(session.messages, jwtToken);
    } catch (retryErr) {
      console.error("Chatbot retry also failed:", retryErr.message);
      replyText = "ဖြေဆိုရာတွင်အမှားရှိခဲ့ပါတယ်။ ပြန်ကြိုးစားပါ။";
    }
  }

  replyText = cleanReply(replyText);

  session.messages.push({ role: "model", text: replyText });
  await session.save();

  res.status(200).json({
    success: true,
    data: { reply: replyText },
  });
});

export const getChatHistory = asyncErrorHandler(async (req, res, next) => {
  const adminId = req.user._id;

  const session = await ChatSession.findOne({ admin: adminId });
  if (!session) {
    return res.status(200).json({
      success: true,
      data: { messages: [] },
    });
  }

  res.status(200).json({
    success: true,
    data: { messages: session.messages },
  });
});

export const clearChatHistory = asyncErrorHandler(async (req, res, next) => {
  const adminId = req.user._id;

  await ChatSession.findOneAndUpdate(
    { admin: adminId },
    { $set: { messages: [] } },
  );

  res.status(200).json({
    success: true,
    message: "Chat history cleared successfully",
  });
});
