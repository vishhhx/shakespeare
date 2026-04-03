import { Document, Types ,model,Schema } from "mongoose";

export interface IVolunteerProfile extends Document {
  userId: Types.ObjectId;

  skills: string[];
  rating?: number;

  totalResponses: number;

  verificationStatus: "verified" | "pending";

  isActive: boolean; // can receive SOS

  badge?: string; // "First Responder", "Medic"

  createdAt: Date;
  updatedAt: Date;
}




const VolunteerProfileSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      required: true,
      unique: true,
    },

    skills: {
      type: [String],
      required: true,
    },

    rating: {
      type: Number,
      default: 0,
    },

    totalResponses: {
      type: Number,
      default: 0,
    },

    verificationStatus: {
      type: String,
      enum: ["verified", "pending"],
      default: "verified",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    badge: String,
  },
  { timestamps: true }
);

export const VolunteerProfileModel = model(
  "VolunteerProfile",
  VolunteerProfileSchema
);