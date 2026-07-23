import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

export const signToken = (id, role, locationId = null) => {
  // Build token payload - only include locationId if it exists
  const payload = { id, role };

  // Only add locationId to payload if it's provided and not null/undefined
  if (locationId) {
    payload.locationId = locationId;
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

export const signPasswordChangeToken = (userId) => {
  const expiresIn = process.env.PASSWORD_CHANGE_TOKEN_EXPIRES_IN || "10m";
  return jwt.sign(
    { id: userId, purpose: "password_change" },
    process.env.JWT_SECRET,
    {
      expiresIn,
    }
  );
};

export const verifyPasswordChangeToken = (token) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== "password_change") {
    const err = new Error("Invalid token purpose");
    err.name = "JsonWebTokenError";
    throw err;
  }
  return payload; // { id, purpose, iat, exp }
};
