import { model, Schema, Document } from "mongoose";
import type { IUser } from "../../types/auth";




const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },
    isprofileComplete: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: ["user", "delivery"],
      required: true,
    },
    fmtoken: [{
      diviceId: String,
      token: String,

    }]
  },
  {
    timestamps: true,
  }
);


const UserModel = model<IUser>("User", userSchema);

export default UserModel;