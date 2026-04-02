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


io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId as string;
  const role = socket.handshake.query.role as string;

  handleSocketConnection(socket, io);
  socket.on("message", (data) => {
    handleMessage(socket, io, userId, data);
  });

  socket.on("location_update", (data) => {
    handleLocationUpdate(socket, userId, data);
  });



  socket.on("disconnect", () => {
    handleSocketDisconnect(socket, userId, role);
  });

  socket.on("error", (error) => {
    handleSocketError(socket, userId, error);
  });
});


app.get("/", (req, res) => {
  res.send("Hello World!");
});


export { app, httpServer, io };
export default app;