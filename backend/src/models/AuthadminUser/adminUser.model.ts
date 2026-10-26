import { Schema, model, Document, Types } from "mongoose";

export interface IAdminUser extends Document {
  email: string;
  password: string;
  name: string;
  role: "responder" | "authority" | "controller-center";
  publicKey?: string;
  passwordHash: string;
  isverified: boolean;
  isprofileComplete: boolean;
  /** Responders only: the authority organisation they work for. */
  authorityProfileId?: Types.ObjectId;
  /** Who provisioned this account (a controller-center admin); absent for seeded accounts. */
  createdBy?: Types.ObjectId;
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
    isverified: {
      type: Boolean,
      default: function (this: IAdminUser): boolean {
        return this.role === "controller-center" || this.role === "authority";
      }
    },
    isprofileComplete: {
      type: Boolean,
      default: function (this: IAdminUser): boolean {
        return this.role === "controller-center" || this.role === "responder";
      },
    },

    role: {
      type: String,
      enum: ["responder", "authority","controller-center"],
      required: true,
    },
    authorityProfileId: {
      type: Schema.Types.ObjectId,
      ref: "AuthorityProfile",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
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