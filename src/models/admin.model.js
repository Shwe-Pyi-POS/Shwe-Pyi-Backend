import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const adminSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    unique: true,
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: [6, "Password must be at least 6 characters long"],
    select: false,
  },
  confirmPassword: {
    type: String,
    validate: {
      validator: function (val) {
        return val == this.password;
      },
      message: "Password Doesn't Match.",
    },
  },
  role: {
    type: String,
    enum: ["owner", "admin", "cashier"],
    required: [true, "Role is required"],
  },
  locationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LocationProfile",
    default: null,
  },
  lastActiveAt: {
    type: Date,
    default: null,
  },

  softDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: null,
  },
});

adminSchema.pre("save", async function () {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
    this.confirmPassword = undefined;
  }
});

adminSchema.methods.comparePasswordInDb = async (pswd, pswdDB) => {
  return await bcrypt.compare(pswd, pswdDB);
};

const Admin = mongoose.model("Admin", adminSchema);

export default Admin;
