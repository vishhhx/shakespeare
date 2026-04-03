import { Document, model, Schema, Types } from "mongoose";


interface AuthorityDocument {
  name: string;
  url: string;
}


interface Location {
  lat: number;
  lng: number;
}


export interface IAuthorityProfile extends Document {
  userId: Types.ObjectId;

  organizationName: string;
  authorityType: "police" | "hospital" | "fire" | "ngo" | "other";

  contactNumber: string;
  officialEmail: string;
  address: string;

  location: Location; 

  officerName?: string;
  designation?: string;

  documents: AuthorityDocument[];

  verificationStatus: "pending" | "verified" | "rejected";

  jurisdiction?: string;

  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}


const AuthorityProfileSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },

    organizationName: {
      type: String,
      required: true,
      trim: true,
    },

    authorityType: {
      type: String,
      enum: ["police", "hospital", "fire", "ngo", "other"],
      required: true,
    },

    contactNumber: {
      type: String,
      required: true,
    },

    officialEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
    },


    location: {
      lat: {
        type: Number,
        required: true,
      },
      lng: {
        type: Number,
        required: true,
      },
    },

    officerName: {
      type: String,
      trim: true,
    },

    designation: {
      type: String,
      trim: true,
    },

    documents: [
      {
        name: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
      },
    ],

    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
      index: true,
    },

    jurisdiction: {
      type: String,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);



export const AuthorityProfileModel = model<IAuthorityProfile>(
  "AuthorityProfile",
  AuthorityProfileSchema
);