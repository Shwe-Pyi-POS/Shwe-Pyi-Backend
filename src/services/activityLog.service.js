import ActivityLog from "../models/activityLog.model.js";

export const logActivity = async ({ admin, action, feature, description, targetId, targetModel, metadata, ip }) => {
  try {
    await ActivityLog.create({ admin, action, feature, description, targetId, targetModel, metadata, ip });
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
};
