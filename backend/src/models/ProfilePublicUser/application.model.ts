import { Document, Types ,Schema,model} from "mongoose";

export interface VolunteerApplication extends Document {
  userId: Types.ObjectId;

  skills: string[]; // ["First Aid", "CPR", "Fire Safety"]

  experience?: string; // "Worked with NGO for 2 years"

  documents: {
    name: string;
    url: string; // stored in S3
  }[];

  preferredRoles: string[]; 
  // ["medical", "rescue", "logistics"]

  availability: {
    isAvailable: boolean;
    timeSlots?: string[]; // optional
  };

  status: "pending" | "approved" | "rejected";

  reviewedBy?: Types.ObjectId; // authority
  reviewNotes?: string;

  createdAt: Date;
  updatedAt: Date;
}




const VolunteerApplicationSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      required: true,
      index: true,
    },

    skills: {
      type: [String],
      required: true,
    },

    experience: String,

    documents: [
      {
        name: String,
        url: String,
      },
    ],

    preferredRoles: {
      type: [String],
      enum: ["medical", "rescue", "logistics", "general"],
      default: ["general"],
    },

    availability: {
      isAvailable: { type: Boolean, default: true },
      timeSlots: [String],
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    reviewedBy: {
      type: Types.ObjectId,
      ref: "User",
    },

    reviewNotes: String,
  },
  { timestamps: true }
);

export const VolunteerApplicationModel = model(
  "VolunteerApplication",
  VolunteerApplicationSchema
);