import { Schema, model, Document } from "mongoose";

export interface IAdminUser extends Document {
  email: string;
  password: string;
  name: string;
  role: "responder" | "authority" | "controller-center";
  publicKey?: string;
  passwordHash: string;

}

const adminUserSchema = new Schema<IAdminUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["responder", "authority","controller-center"],
      required: true,
    },
        publicKey:{
          type:String,
        required:function(){     
               return this.role === "authority";
        }
        
    }   
    ,
  },
  {
    timestamps: true,
  }
);

export const AdminUserModel = model<IAdminUser>(
  "AdminUser",
  adminUserSchema
);