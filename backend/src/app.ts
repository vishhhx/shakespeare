import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createServer } from "http";


import {
  handleSocketConnection,
  handleSocketDisconnect,
  handleMessage,
  handleLocationUpdate,
  handleSocketError,
} from "./handlers/socketHandlers";
import publicUserRouter from "./models/publicUser/publicUser.router";
import { verifyToken } from "./utils/jwt";
import { AdminUserModel } from "./models/adminUser/adminUser.model";
import { PublicUserModel } from "./models/publicUser/publicUser.model";

const app = express();

const isAllowedDevOrigin = (origin?: string) => {
  if (!origin) {
    return true;
  }

  if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) {
    return true;
  }

  return (
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
    /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin) ||
    /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin) ||
    /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/.test(origin) ||
    /^exp:\/\//.test(origin)
  );
};

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedDevOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use("/api/public-user", publicUserRouter);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedDevOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Socket origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
  allowEIO3: true,
});

console.log("Socket.io server initialized");

type SocketRole = "public" | "volunteer" | "responder" | "authority";

const isAdminRole = (role: string): role is "responder" | "authority" => {
  return role === "responder" || role === "authority";
};

const isPublicRole = (role: string): role is "public" | "volunteer" => {
  return role === "public" || role === "volunteer";
};

const extractSocketToken = (socket: any): string | null => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken.startsWith("Bearer ")
      ? authToken.slice(7).trim()
      : authToken.trim();
  }

  const headerToken = socket.handshake?.headers?.authorization;
  if (typeof headerToken === "string" && headerToken.startsWith("Bearer ")) {
    return headerToken.slice(7).trim();
  }

  return null;
};

io.use(async (socket, next) => {
  try {
    const token = extractSocketToken(socket);
    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = verifyToken(token);
    if (!payload?.role) {
      return next(new Error("Invalid or expired token"));
    }

    if (isAdminRole(payload.role)) {
      const adminUser = payload.userId
        ? await AdminUserModel.findById(payload.userId).select("_id role").lean()
        : payload.email
          ? await AdminUserModel.findOne({ email: payload.email }).select("_id role").lean()
          : null;

      if (!adminUser) {
        return next(new Error("Authenticated admin user not found"));
      }

      socket.data.authUser = {
        userId: String(adminUser._id),
        role: adminUser.role as SocketRole,
      };

      return next();
    }

    if (isPublicRole(payload.role)) {
      const publicUser = payload.userId
        ? await PublicUserModel.findOne({ _id: payload.userId, isVerified: true })
            .select("_id role isVerified")
            .lean()
        : payload.phoneNumber
          ? await PublicUserModel.findOne({ phoneNumber: payload.phoneNumber, isVerified: true })
              .select("_id role isVerified")
              .lean()
          : null;

      if (!publicUser || !publicUser.isVerified) {
        return next(new Error("User must be authenticated and verified"));
      }

      socket.data.authUser = {
        userId: String(publicUser._id),
        role: publicUser.role as SocketRole,
      };

      return next();
    }

    return next(new Error("Unsupported user role"));
  } catch (error) {
    console.error("Socket auth middleware error:", error);
    return next(new Error("Socket authentication failed"));
  }
});


io.on("connection", (socket) => {
  const authUser = socket.data.authUser as
    | { userId: string; role: SocketRole }
    | undefined;

  if (!authUser?.userId || !authUser?.role) {
    socket.disconnect(true);
    return;
  }

  handleSocketConnection(socket, io, authUser);
  socket.on("message", (data) => {
    handleMessage(socket, io, authUser.userId, data);
  });

  socket.on("location_update", (data) => {
    handleLocationUpdate(socket, authUser.userId, data);
  });



  socket.on("disconnect", () => {
    handleSocketDisconnect(socket, authUser.userId, authUser.role);
  });

  socket.on("error", (error) => {
    handleSocketError(socket, authUser.userId, error);
  });
});


app.get("/", (req, res) => {
  res.send("Hello World!");
});


export { app, httpServer, io };
export default app;