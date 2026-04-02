
import { Schema, model, Document } from "mongoose";

export interface IPublicUser extends Document {
  phoneNumber: string;
  name?: string;
  role: "public" | "volunteer";
  isVerified: boolean;
  avatarUrl?: string;
  isprofileComplete: boolean;
}

const publicUserSchema = new Schema<IPublicUser>(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
    },

    name: {
      type: String,
    },

    role: {
      type: String,
      enum: ["public", "volunteer"],
      required: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    avatarUrl: {
      type: String,
    },
    isprofileComplete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export const PublicUserModel = model<IPublicUser>(
  "PublicUser",
  publicUserSchema
);