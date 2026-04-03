import { Document, model, Schema, Types } from "mongoose";

export interface Contact {
  name: string;
  phoneNumber: string;
  relation?: string;       
  isPrimary?: boolean;     
}

export interface MedicalRecord {
  bloodGroup: string;
  allergies: string[];
  medications: string[];
  diseases: string[];
  notes?: string;         
}

export interface IProfilePublicUser extends Document {
  userId: Types.ObjectId;  
  name: string;
  phoneNumber: string;
  profileImage?: string;
  contacts: Contact[];      
  appContacts: Types.ObjectId[]; 
  medicalRecord: MedicalRecord;
  sosMessage?: string;      
  autoShareMedical?: boolean;
  location?: {
    lat: number;
    lng: number;
  };
  enableContinuousTracking?: boolean;
  lastLocationUpdate?: Date;
  createdAt: Date;
  updatedAt: Date;
}



const ContactSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    relation: {
      type: String,
      trim: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);


const MedicalRecordSchema = new Schema(
  {
    bloodGroup: {
      type: String,
      required: true,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
    allergies: {
      type: [String],
      default: [],
    },
    medications: {
      type: [String],
      default: [],
    },
    diseases: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
    },
  },
  { _id: false }
);


const ProfilePublicUserSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      required: true,
      unique: true, 
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phoneNumber: {
      type: String,
      required: true,
    },

    profileImage: {
      type: String,
    },

    contacts: {
      type: [ContactSchema],
      default: [],
    },

    appContacts: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],

    medicalRecord: {
      type: MedicalRecordSchema,
      required: true,
    },

    sosMessage: {
      type: String,
      default: "I need help, please track my location.",
    },

    autoShareMedical: {
      type: Boolean,
      default: true,
    },

    location: {
      lat: {
        type: Number,
      },
      lng: {
        type: Number,
      },
    },

    enableContinuousTracking: {
      type: Boolean,
      default: false,
    },

    lastLocationUpdate: {
      type: Date,
    },
  },
  {
    timestamps: true, 
  }
);

export const ProfilePublicUserModel = model(
  "ProfilePublicUser",
  ProfilePublicUserSchema
);