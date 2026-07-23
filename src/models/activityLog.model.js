import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: [true, "Admin is required"],
  },
  action: {
    type: String,
    required: [true, "Action is required"],
    trim: true,
  },
  feature: {
    type: String,
    required: [true, "Feature is required"],
    trim: true,
  },
  description: {
    type: String,
    required: [true, "Description is required"],
    trim: true,
    maxlength: [500, "Description cannot exceed 500 characters"],
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  targetModel: {
    type: String,
    default: null,
    trim: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  ip: {
    type: String,
    default: null,
    trim: true,
  },
}, {
  timestamps: true,
});

activityLogSchema.index({ admin: 1 });
activityLogSchema.index({ feature: 1, createdAt: -1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ targetId: 1, targetModel: 1 });
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
activityLogSchema.index({ createdAt: -1 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export default ActivityLog;
