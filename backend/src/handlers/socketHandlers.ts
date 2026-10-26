import { Socket, Server } from "socket.io";
import redisService from "../utils/redis";
import { AuthorityProfileModel } from "../models/ProfileAdminUser/authority.model";

type SocketAuthUser = {
  userId: string;
  role: "public" | "volunteer" | "responder" | "authority" | "controller-center";
};

export const handleSocketConnection = async (
  socket: Socket,
  io: Server,
  authUser: SocketAuthUser
) => {
  const { userId, role } = authUser;

  console.log(`User connected: ${userId} (${role}) - Socket: ${socket.id}`);
  try {
    await redisService.storeSocketId(role, userId, socket.id);
    console.log(` Socket ID stored in Redis: ${role}:${userId}=${socket.id}`);
  } catch (error) {
    console.error(" Error storing socket ID in Redis:", error);
  }
  socket.join(`${role}:${userId}`);
  socket.join(role);
  console.log(` User joined rooms: ${role}:${userId}, ${role}`);

  // Emergency and volunteer alerts for an organisation go to `authority:<authorityProfileId>`.
  // Join it server-side so alerts keep arriving after reconnects, whatever page is open.
  let ownAuthorityRoom: string | null = null;
  if (role === "authority") {
    try {
      const profile = await AuthorityProfileModel.findOne({ userId }).select("_id").lean();
      if (profile?._id) {
        ownAuthorityRoom = `authority:${String(profile._id)}`;
        socket.join(ownAuthorityRoom);
      }
    } catch (error) {
      console.error(" Error joining authority room:", error);
    }
  }

  // Kept for older web builds; only an authority may join, and only its own organisation's room.
  socket.on("join-authority", (data) => {
    const authorityId = String(data?.authorityId || "");
    if (role === "authority" && ownAuthorityRoom === `authority:${authorityId}`) {
      socket.join(ownAuthorityRoom);
      return;
    }
    socket.emit("error", { message: "Not allowed to join that authority room" });
  });
};

export const handleSocketDisconnect = async (socket: Socket, userId: string, role: string) => {
  console.log(` User disconnected: ${userId} (${role})`);
  try {
    const result = await redisService.removeSocketId(role, userId);
    console.log(` Socket ID removed from Redis: ${role}:${userId}`);
  } catch (error) {
    console.error(" Error removing socket ID from Redis:", error);
  }
};

// Volunteer workflow socket events
export const emitVolunteerApplicationCreated = (
  io: Server,
  authorityId: string,
  application: any
) => {
  io.to(`authority:${authorityId}`).emit("volunteer-application-created", {
    application,
    message: "New volunteer application assigned to your authority",
  });
};

export const emitVolunteerApplicationReviewed = (
  io: Server,
  userId: string,
  status: "approved" | "rejected",
  authorityName?: string
) => {
  io.to(`public:${userId}`).emit("volunteer-application-reviewed", {
    status,
    message: status === "approved" 
      ? `Your volunteer application has been approved by ${authorityName || 'the authority'}!`
      : `Your volunteer application has been rejected by ${authorityName || 'the authority'}.`,
  });
};



export const handleSocketError = (socket: Socket, userId: string, error: Error) => {
  console.error(` Socket error for ${userId}:`, error);
};

