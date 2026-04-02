import { Schema, model, Document } from "mongoose";

export interface IAdminUser extends Document {
  email: string;
  password: string;
  name: string;
  role: "responder" | "authority";
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["responder", "authority"],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const AdminUserModel = model<IAdminUser>(
  "AdminUser",
  adminUserSchema
);