import { Socket, Server } from "socket.io";
import redisService from "../utils/redis";

type SocketAuthUser = {
  userId: string;
  role: "public" | "volunteer" | "responder" | "authority";
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

  // Handle authority joining their room
  socket.on("join-authority", (data) => {
    const { authorityId } = data;
    socket.join(`authority:${authorityId}`);
    console.log(`Authority joined room: authority:${authorityId}`);
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

export const handleMessage = (socket: Socket, io: Server, userId: string, data: any) => {
  console.log(` Message from ${userId}:`, data);
  io.emit("message", { userId, ...data });
};

export const handleLocationUpdate = (socket: Socket, userId: string, data: any) => {
  console.log(` Location update from ${userId}:`, data);
  socket.broadcast.emit("delivery_partner_location", {
    userId,
    ...data,
  });
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

