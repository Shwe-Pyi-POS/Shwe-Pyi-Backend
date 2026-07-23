import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "model"],
    required: [true, "Role is required"],
  },
  text: {
    type: String,
    required: [true, "Message text is required"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const chatSessionSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: [true, "Admin is required"],
    unique: true,
  },
  messages: {
    type: [chatMessageSchema],
    default: [],
  },
}, { timestamps: true });

chatSessionSchema.pre("save", function () {
  if (this.messages.length > 10) {
    const excess = this.messages.length - 10;
    this.messages.splice(0, excess);
  }
});

const ChatSession = mongoose.model("ChatSession", chatSessionSchema);

export default ChatSession;
