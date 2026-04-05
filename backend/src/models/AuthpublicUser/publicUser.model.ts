
import { Schema, model, Document, Types } from "mongoose";

export interface IPublicUser extends Document {
  phoneNumber: string;
  name?: string;
  age?: number;
  gender?: "male" | "female" | "other";
  role: "public" | "volunteer";
  isVerified: boolean;
  avatarUrl?: string;
  isprofileComplete: boolean;
  isFaceProcessed: boolean;
  faceEmbeddingID: string;
  faceEmbeddingPhoto: string;
  rewardPoints: number;
  fraudFlaggedBy: Types.ObjectId[];
  fraudFlagCount: number;
  isPermanentlyBlocked: boolean;
  permanentlyBlockedAt?: Date;
  permanentBlockReason?: string;
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

    age: {
      type: Number,
      min: 1,
      max: 120,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
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
    isFaceProcessed: {
      type: Boolean,
      default: false,
    },
    faceEmbeddingID: {
      type: String,
      default: "",
    },
    faceEmbeddingPhoto: {
      type: String,
      default: "",
    },
    rewardPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    fraudFlaggedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "PublicUser",
      },
    ],
    fraudFlagCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isPermanentlyBlocked: {
      type: Boolean,
      default: false,
    },
    permanentlyBlockedAt: {
      type: Date,
    },
    permanentBlockReason: {
      type: String,
      default: "",
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