import mongoose from "mongoose";
import dotenv from "dotenv";
import app from "../src/app.js";

dotenv.config({ path: "./.env" });

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  try {
    mongoose.set("strictQuery", false);
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    cachedDb = conn;
    console.log("Database Connected:", conn.connection.host);
    return cachedDb;
  } catch (error) {
    console.error("Database connection failed:", error.message);
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    await connectToDatabase();
    return app(req, res);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}
