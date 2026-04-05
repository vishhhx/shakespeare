import { Schema, model, Types, Document } from "mongoose";

export interface Emergency extends Document {
  title: string;
  description?: string;

  type: "medical" | "fire" | "crime" | "accident" | "missing_child" | "other";
  severity: "low" | "medium" | "high" | "critical";

  status: "reported" | "verified" | "in_progress" | "resolved" | "closed";


  reportedBy: Types.ObjectId;
  relationToVictim: "self" | "family" | "bystander" | "authority";


  location: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
    address?: string;
  };


  media: {
    type: "image" | "video" | "audio";
    url: string;
  }[];

  victims: {
    userId?: Types.ObjectId;
    name?: string;
    age?: number;
    gender?: string;

    condition?: string; 
    isPrimary?: boolean;

    contactInfo?: string;

    faceImageUrl?: string;
    faceEmbeddingId?: string; 
    status?: "unknown" | "identified" | "missing";
    confidence?: number; 
  }[];

  victimsCount?: number;

  responders: {
    userId: Types.ObjectId;
    role: "volunteer" | "authority";

    status: "assigned" | "enroute" | "on_scene" | "completed";

    location?: {
      type: "Point";
      coordinates: [number, number];
    };

    joinedAt: Date;
    updatedAt?: Date;
  }[];


  timeline: {
    event: string; 
    timestamp: Date;
    actorId?: Types.ObjectId;
    meta?: any;
  }[];


  isFake?: boolean;
  confidenceScore?: number;

  priorityScore?: number; // computed priority

  createdAt: Date;
  updatedAt: Date;
}


const emergencySchema = new Schema<Emergency>(
  {
    title: { type: String, required: true },
    description: String,

    type: {
      type: String,
      enum: ["medical", "fire", "crime", "accident", "missing_child", "other"],
      required: true,
    },

    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    status: {
      type: String,
      enum: ["reported", "verified", "in_progress", "resolved", "closed"],
      default: "reported",
    },

    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    relationToVictim: {
      type: String,
      enum: ["self", "family", "bystander", "authority"],
      default: "self",
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
      address: String,
    },

    media: [
      {
        type: {
          type: String,
          enum: ["image", "video", "audio"],
        },
        url: String,
      },
    ],

    victims: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        name: String,
        age: Number,
        gender: String,

        condition: String,
        isPrimary: Boolean,

        contactInfo: String,

        faceImageUrl: String,
        faceEmbeddingId: String, // 🔥 link to Qdrant

        status: {
          type: String,
          enum: ["unknown", "identified", "missing"],
          default: "unknown",
        },

        confidence: Number,
      },
    ],

    victimsCount: Number,

    responders: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },

        role: {
          type: String,
          enum: ["volunteer", "authority"],
        },

        status: {
          type: String,
          enum: ["assigned", "enroute", "on_scene", "completed"],
          default: "assigned",
        },

        location: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: [Number],
        },

        joinedAt: {
          type: Date,
          default: Date.now,
        },

        updatedAt: Date,
      },
    ],

    timeline: [
      {
        event: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        actorId: { type: Schema.Types.ObjectId, ref: "User" },
        meta: Schema.Types.Mixed,
      },
    ],

    isFake: Boolean,
    confidenceScore: Number,
    priorityScore: Number,
  },
  { timestamps: true }
);

// 🔥 GEO INDEX (Mongo fallback search)
emergencySchema.index({ location: "2dsphere" });


const EmergencyModel = model<Emergency>("Emergency", emergencySchema);

export default EmergencyModel;