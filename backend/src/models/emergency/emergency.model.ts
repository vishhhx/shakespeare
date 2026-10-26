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
    /** Legacy two-value role kept for existing readers; `actorRole` is the account's real role. */
    role: "volunteer" | "authority";
    actorRole?: "public" | "volunteer" | "responder" | "authority" | "controller-center";

    status: "assigned" | "enroute" | "on_scene" | "completed";

    location?: {
      type: "Point";
      coordinates: [number, number];
    };
    /** When the device recorded `location`; older updates are ignored. */
    locationUpdatedAt?: Date;

    assignedBy?: Types.ObjectId;
    assignedByRole?: "authority" | "controller-center";

    joinedAt: Date;
    updatedAt?: Date;
  }[];


  timeline: {
    event: string; 
    timestamp: Date;
    actorId?: Types.ObjectId;
    meta?: any;
  }[];


  /** Reporter's live position while the case is open (the incident location never moves). */
  reporterLocation?: {
    coordinates: [number, number]; // [lng, lat]
    updatedAt: Date;
  };
  /** Client-generated key so a retried SOS request returns the case it already created. */
  clientRequestId?: string;
  isFake?: boolean;
  confidenceScore?: number;

  priorityScore?: number; // computed priority

  fakeFlags?: {
    flaggedBy: Types.ObjectId;
    flaggerRole: "public" | "volunteer" | "authority" | "responder" | "controller-center";
    reason?: string;
    createdAt: Date;
  }[];

  pointsAwards?: {
    userId: Types.ObjectId;
    points: number;
    awardedBy: Types.ObjectId;
    awardedByRole: "authority" | "controller-center";
    note?: string;
    awardedAt: Date;
  }[];

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

        actorRole: {
          type: String,
          enum: ["public", "volunteer", "responder", "authority", "controller-center"],
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

        locationUpdatedAt: Date,

        assignedBy: { type: Schema.Types.ObjectId },
        assignedByRole: {
          type: String,
          enum: ["authority", "controller-center"],
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

    reporterLocation: {
      coordinates: [Number],
      updatedAt: Date,
    },

    clientRequestId: String,
    isFake: Boolean,
    confidenceScore: Number,
    priorityScore: Number,
    fakeFlags: [
      {
        flaggedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        flaggerRole: {
          type: String,
          enum: ["public", "volunteer", "authority", "responder", "controller-center"],
          required: true,
        },
        reason: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    pointsAwards: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        points: { type: Number, required: true, min: 1 },
        awardedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        awardedByRole: {
          type: String,
          enum: ["authority", "controller-center"],
          required: true,
        },
        note: String,
        awardedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// 🔥 GEO INDEX (Mongo fallback search)
emergencySchema.index({ location: "2dsphere" });
emergencySchema.index({ reportedBy: 1, status: 1 });
emergencySchema.index({ "responders.userId": 1, status: 1 });
emergencySchema.index({ reportedBy: 1, clientRequestId: 1 }, { sparse: true });


const EmergencyModel = model<Emergency>("Emergency", emergencySchema);

export default EmergencyModel;