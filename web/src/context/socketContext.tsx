import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAppSelector } from "@/store/hooks";
import { AuthServices } from "@/services";
import authorityAlertAudio from "@/assets/WhatsApp Audio 2026-04-05 at 1.05.00 AM (1).mpeg";

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

    const currentHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const socketUrl = import.meta.env.VITE_SOCKET_URL || `http://${currentHost}:4000`;
    console.log("[🔌 Web Socket] Connecting:", {
      socketUrl,
      host: currentHost,
      role: authData?.role,
      isVerified,
    });

    const nextSocket = io(socketUrl, {
      transports: ["websocket", "polling"],
      auth: { token: `Bearer ${token}` },
      withCredentials: true,
    });

    nextSocket.on("connect", () => {
      console.log("[🔌 Web Socket] Connected", { id: nextSocket.id, url: socketUrl });
      setConnected(true);
    });
    nextSocket.on("disconnect", (reason) => {
      console.warn("[🔌 Web Socket] Disconnected", { reason });
      setConnected(false);
    });
    nextSocket.on("connect_error", (error) => {
      console.error("[🔌 Web Socket] Connect error", {
        message: error?.message,
        description: (error as any)?.description,
        context: (error as any)?.context,
        socketUrl,
      });
    });

    const playAlert = () => {
      const audio = new Audio(authorityAlertAudio);
      void audio.play().catch(() => {
        // Browser autoplay policies can block this until user gesture.
      });
    };

    const role = authData?.role;
    const handleAuthorityEmergencyAlert = (payload: any) => {
      playAlert();

      if (role !== "authority" && role !== "responder" && role !== "controller-center") {
        return;
      }

      const emergencyId = String(payload?.emergencyId || "");
      const message = String(payload?.message || "Emergency reported in your nearby area.");
      if (!emergencyId) {
        return;
      }

      const accepted = window.confirm(`${message}\n\nEmergency ID: ${emergencyId}\n\nAccept emergency response request?`);
      if (!accepted) {
        return;
      }

      void AuthServices.acceptEmergencyResponse(emergencyId)
        .then((response) => {
          window.alert(response?.trackingNotice || "Your location activity will be tracked for this emergency response.");
          window.location.assign(`/emergency/${encodeURIComponent(emergencyId)}?autoJoin=1`);
        })
        .catch((error: any) => {
          window.alert(error?.response?.data?.error || error?.message || "Failed to accept emergency response.");
        });
    };

    nextSocket.on("emergency-authority-alert", handleAuthorityEmergencyAlert);
    nextSocket.on("emergency-nearby-alert", handleAuthorityEmergencyAlert);
    nextSocket.on("emergency-controller-alert", handleAuthorityEmergencyAlert);

    setSocket(nextSocket);

    return () => {
      nextSocket.off("emergency-authority-alert", handleAuthorityEmergencyAlert);
      nextSocket.off("emergency-nearby-alert", handleAuthorityEmergencyAlert);
      nextSocket.off("emergency-controller-alert", handleAuthorityEmergencyAlert);
      nextSocket.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [authData?.token, authData?.isVerified, authData?.isverified, authData?.role]);

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