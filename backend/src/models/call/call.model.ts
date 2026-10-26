import { Schema, model, Types, type Document } from "mongoose";

// One emergency video call. Media flows through the SafeSphere SFU (media-server/), never
// through this database: here we only keep who may join, who was invited and who is connected.
// The call lifecycle is separate from the emergency's: ending a call never closes the case.

export type CallStatus = "ringing" | "active" | "ended" | "failed";
export type InviteStatus = "caller" | "invited" | "accepted" | "declined" | "expired" | "cancelled";
export type CallRole = "public" | "volunteer" | "responder" | "authority" | "controller-center";
export type ConnectionState = "not_joined" | "connected" | "reconnecting" | "left";

export interface CallParticipant {
  userId: Types.ObjectId;
  role: CallRole;
  name: string;
  /** Organisation shown next to authority / responder names. */
  organization?: string;
  inviteStatus: InviteStatus;
  invitedBy?: Types.ObjectId;
  invitedByRole?: CallRole;
  invitedAt?: Date;
  respondedAt?: Date;
  connection: ConnectionState;
  joinedAt?: Date;
  leftAt?: Date;
  /** Media server peer id of the current connection (a refresh replaces it). */
  mediaPeerId?: string;
}

export interface EmergencyCall extends Document {
  emergencyId: Types.ObjectId;
  /** Media-server room name; unique per call so a new call never inherits an old room. */
  roomId: string;
  status: CallStatus;
  /** Set while ringing/active; a partial unique index allows one open call per emergency. */
  isOpen?: boolean;
  initiatedBy: { userId: Types.ObjectId; role: CallRole };
  answeredBy?: { userId: Types.ObjectId; name: string; at: Date };
  declinedBy: { userId: Types.ObjectId; name: string; at: Date }[];
  participants: CallParticipant[];
  endedAt?: Date;
  endedBy?: { userId?: Types.ObjectId; role?: CallRole };
  endReason?: "ended_by_host" | "case_closed" | "everyone_left" | "media_failure" | "caller_cancelled";
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<CallParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["public", "volunteer", "responder", "authority", "controller-center"], required: true },
    name: { type: String, required: true },
    organization: String,
    inviteStatus: {
      type: String,
      enum: ["caller", "invited", "accepted", "declined", "expired", "cancelled"],
      required: true,
    },
    invitedBy: Schema.Types.ObjectId,
    invitedByRole: { type: String, enum: ["public", "volunteer", "responder", "authority", "controller-center"] },
    invitedAt: Date,
    respondedAt: Date,
    connection: { type: String, enum: ["not_joined", "connected", "reconnecting", "left"], default: "not_joined" },
    joinedAt: Date,
    leftAt: Date,
    mediaPeerId: String,
  },
  { _id: false },
);

const callSchema = new Schema<EmergencyCall>(
  {
    emergencyId: { type: Schema.Types.ObjectId, ref: "Emergency", required: true },
    roomId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["ringing", "active", "ended", "failed"], default: "ringing", required: true },
    isOpen: Boolean,
    initiatedBy: {
      userId: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true },
    },
    answeredBy: { userId: Schema.Types.ObjectId, name: String, at: Date },
    declinedBy: [{ userId: Schema.Types.ObjectId, name: String, at: Date, _id: false }],
    participants: [participantSchema],
    endedAt: Date,
    endedBy: { userId: Schema.Types.ObjectId, role: String },
    endReason: String,
  },
  { timestamps: true },
);

// At most one ringing/active call per emergency, even under concurrent SOS retries.
callSchema.index({ emergencyId: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
callSchema.index({ status: 1, createdAt: -1 });
callSchema.index({ "participants.userId": 1, status: 1 });

export const EmergencyCallModel = model<EmergencyCall>("EmergencyCall", callSchema);
