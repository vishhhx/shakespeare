import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAppSelector } from "@/store/hooks";

type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketContextValue | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
  const authData = useAppSelector((state) => state.auth.authData);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = authData?.token;
    const isVerified = authData?.isVerified ?? authData?.isverified;

    if (!token || !isVerified) {
      socket?.disconnect();
      setSocket(null);
      setConnected(false);
      return;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
    const nextSocket = io(socketUrl, {
      transports: ["websocket", "polling"],
      auth: { token: `Bearer ${token}` },
      withCredentials: true,
    });

    nextSocket.on("connect", () => setConnected(true));
    nextSocket.on("disconnect", () => setConnected(false));

    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [authData?.token, authData?.isVerified, authData?.isverified]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }

  return context;
}