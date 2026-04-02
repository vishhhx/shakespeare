import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AuthContext } from "./authContext";
import { config } from "../lib/config";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  emit: (event: string, data?: any) => void;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string, callback?: (data: any) => void) => void;
}

export const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  emit: () => {},
  on: () => {},
  off: () => {},
});

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { userDetails } = useContext(AuthContext);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    let isMounted = true;

    if (!userDetails?.userId || !userDetails?.role) {
      return;
    }

    const connectSocket = async () => {
      const token = await AsyncStorage.getItem("authToken");
      if (!token || !isMounted) {
        return;
      }

      const SOCKET_URL = config.socketUrl;

      console.log(`Connecting to Socket.io: ${SOCKET_URL}`);

      socketRef.current = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: maxReconnectAttempts,
        transports: ["websocket"],
        rejectUnauthorized: false,
        timeout: 20000,
        auth: {
          token,
        },
      });

      socketRef.current.on("connect", () => {
        console.log("Socket connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      });

      socketRef.current.on("disconnect", () => {
        console.log("Socket disconnected");
        setIsConnected(false);
      });

      socketRef.current.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
        reconnectAttemptsRef.current += 1;
      });

      socketRef.current.on("reconnect_attempt", () => {
        console.log(`Socket reconnection attempt ${reconnectAttemptsRef.current + 1}`);
      });

      socketRef.current.on("reconnect", () => {
        console.log("Socket reconnected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      });
    };

    void connectSocket();

    return () => {
      isMounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [userDetails?.userId, userDetails?.role]);

  const emit = (event: string, data?: any) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(event, data);
    } else {
      console.warn("Socket not connected. Event not sent:", event);
    }
  };

  const on = (event: string, callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback);
    }
  };

  const off = (event: string, callback?: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback);
    }
  };

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        emit,
        on,
        off,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
