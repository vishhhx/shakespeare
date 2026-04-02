import { Socket, Server } from "socket.io";
import redisService from "../utils/redis";


export const handleSocketConnection = async (socket: Socket, io: Server) => {
  const userId = socket.handshake.query.userId as string;
  const role = socket.handshake.query.role as string;
  if (!userId || !role) {
    console.warn("Socket connection rejected: missing userId or role");
    socket.disconnect();
    return;
  }
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



export const handleSocketError = (socket: Socket, userId: string, error: Error) => {
  console.error(` Socket error for ${userId}:`, error);
};

