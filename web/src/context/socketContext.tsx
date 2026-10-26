import { useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";

import { SocketContext } from "./socket";

import { useAppSelector } from "@/store/hooks";
import { EmergencyServices } from "@/services";
import { SEVERITY_LABELS, TYPE_LABELS, errorMessage, type EmergencySeverity, type EmergencyType } from "@/lib/emergency";
import authorityAlertAudio from "@/assets/WhatsApp Audio 2026-04-05 at 1.05.00 AM (1).mpeg";


// The provider sits outside the router, so navigate through the router object (no page reload).
const navigateTo = (path: string) => {
  void import("@/Router").then((module) => module.default.navigate(path));
};

type AlertPayload = {
  emergencyId?: string;
  title?: string;
  type?: EmergencyType;
  severity?: EmergencySeverity;
  message?: string;
  distanceKm?: number;
};

const ALERT_EVENTS = ["emergency-authority-alert", "emergency-controller-alert", "emergency-nearby-alert"] as const;

export function SocketProvider({ children }: { children: ReactNode }) {
  const authData = useAppSelector((state) => state.auth.authData);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = authData?.token;
    const isVerified = authData?.isVerified ?? authData?.isverified;
    const role = authData?.role;

    // Signed out: the previous effect's cleanup already disconnected and cleared state.
    if (!token || !isVerified) return;

    const currentHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const socketUrl = import.meta.env.VITE_SOCKET_URL || `http://${currentHost}:4000`;

    const nextSocket = io(socketUrl, {
      transports: ["websocket", "polling"],
      auth: { token: `Bearer ${token}` },
      withCredentials: true,
      reconnection: true,
      reconnectionDelayMax: 10000,
    });

    nextSocket.on("connect", () => setConnected(true));
    nextSocket.on("disconnect", () => setConnected(false));
    nextSocket.on("connect_error", (error) => {
      console.warn("[socket] connect error:", error?.message);
    });

    const playAlert = () => {
      const audio = new Audio(authorityAlertAudio);
      void audio.play().catch(() => {
        // Browsers block autoplay until the page has had a user gesture.
      });
    };

    const handleEmergencyAlert = (payload: AlertPayload) => {
      const emergencyId = String(payload?.emergencyId || "");
      if (!emergencyId) return;
      playAlert();

      const summary = [
        payload.type ? TYPE_LABELS[payload.type] : null,
        payload.severity ? `${SEVERITY_LABELS[payload.severity]} severity` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      // Field staff can accept straight from the alert; the control center triages from the queue.
      const canAccept = role === "authority" || role === "responder";
      toast.warning(payload.title || "New emergency", {
        id: `alert-${emergencyId}`,
        description: [summary, payload.message].filter(Boolean).join(" — "),
        duration: 30000,
        action: { label: "Open case", onClick: () => navigateTo(`/emergency/${encodeURIComponent(emergencyId)}`) },
        cancel: canAccept
          ? {
              label: "Accept",
              onClick: () => {
                void EmergencyServices.accept(emergencyId)
                  .then(() => {
                    toast.success("You're on this case.");
                    navigateTo(`/emergency/${encodeURIComponent(emergencyId)}`);
                  })
                  .catch((error) => toast.error(errorMessage(error, "Couldn't accept this emergency.")));
              },
            }
          : undefined,
      });
    };

    const handleAssigned = (payload: AlertPayload & { assignedByRole?: string }) => {
      const emergencyId = String(payload?.emergencyId || "");
      if (!emergencyId) return;
      playAlert();
      toast.warning("You've been assigned to an emergency", {
        id: `assigned-${emergencyId}`,
        description: payload.title,
        duration: 60000,
        action: { label: "Open case", onClick: () => navigateTo(`/emergency/${encodeURIComponent(emergencyId)}`) },
      });
    };

    for (const event of ALERT_EVENTS) nextSocket.on(event, handleEmergencyAlert);
    nextSocket.on("emergency-assigned", handleAssigned);

    // The socket is created by this effect and published to consumers; this is the sync point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(nextSocket);

    return () => {
      for (const event of ALERT_EVENTS) nextSocket.off(event, handleEmergencyAlert);
      nextSocket.off("emergency-assigned", handleAssigned);
      nextSocket.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [authData?.token, authData?.isVerified, authData?.isverified, authData?.role]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
