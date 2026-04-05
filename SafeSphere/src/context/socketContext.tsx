import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AuthContext } from "./authContext";
import { config } from "../lib/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { acceptEmergencyResponse } from "../lib/api";
import { router } from "expo-router";

const ACTIVE_CASE_STORAGE_KEY = "activeEmergencyCase";

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
  const connectionModeRef = useRef<"primary" | "fallback">("primary");
  const currentAlertSoundRef = useRef<Audio.Sound | null>(null);

  const stopEmergencyAlertSound = useCallback(async () => {
    if (!currentAlertSoundRef.current) return;
    try {
      await currentAlertSoundRef.current.stopAsync();
      await currentAlertSoundRef.current.unloadAsync();
    } catch {
      // Ignore stop/unload failures.
    } finally {
      currentAlertSoundRef.current = null;
    }
  }, []);

  const playEmergencyAlertSound = useCallback(async () => {
    try {
      await stopEmergencyAlertSound();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        require("../../assets/sounds/WhatsApp Audio 2026-04-05 at 1.05.00 AM.mpeg"),
        {
          shouldPlay: true,
          isLooping: true,
          volume: 1,
        },
      );
      currentAlertSoundRef.current = sound;
    } catch (error) {
      console.warn("Failed to play emergency alert sound", error);
    }
  }, [stopEmergencyAlertSound]);

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

      const SOCKET_URL = connectionModeRef.current === "fallback" ? config.fallbackSocketUrl : config.socketUrl;

      console.log(`Connecting to Socket.io: ${SOCKET_URL}`);

      socketRef.current = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: maxReconnectAttempts,
        transports: ["websocket", "polling"],
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

      const handleEmergencyAlert = (payload: any) => {
        void playEmergencyAlertSound();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

        const emergencyId = String(payload?.emergencyId || "");
        const message = String(payload?.message || "Emergency reported near you.");
        const role = userDetails?.role;
        const canAccept = (role === "public" || role === "volunteer") && emergencyId.length > 0;

        Alert.alert(
          "Emergency Alert",
          `${message}\n\nEmergency ID: ${emergencyId || "N/A"}`,
          canAccept
            ? [
                { text: "Ignore", style: "cancel" },
                {
                  text: "Reject",
                  style: "destructive",
                  onPress: () => {
                    void stopEmergencyAlertSound();
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                  },
                },
                {
                  text: "Accept",
                  onPress: () => {
                    void (async () => {
                      try {
                        await stopEmergencyAlertSound();
                        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        const response = await acceptEmergencyResponse(emergencyId);
                        await AsyncStorage.setItem(
                          ACTIVE_CASE_STORAGE_KEY,
                          JSON.stringify({ emergencyId, acceptedAt: new Date().toISOString() }),
                        );
                        Alert.alert("Response Accepted", response.trackingNotice || "Your location activity will be tracked for this emergency response.");
                        router.push({ pathname: "/case", params: { emergencyId, autoJoin: "1" } });
                      } catch (error: any) {
                        Alert.alert("Unable to accept", error?.response?.data?.error || error?.message || "Failed to accept emergency response.");
                      }
                    })();
                  },
                },
              ]
            : [{ text: "OK", onPress: () => { void stopEmergencyAlertSound(); } }],
        );
      };

      socketRef.current.on("emergency-nearby-alert", handleEmergencyAlert);
      socketRef.current.on("emergency-contact-alert", handleEmergencyAlert);
      socketRef.current.on("emergency-authority-alert", handleEmergencyAlert);
      socketRef.current.on("emergency-case-closed", (payload: { emergencyId?: string; message?: string }) => {
        const emergencyId = String(payload?.emergencyId || "");

        void (async () => {
          try {
            const activeCaseRaw = await AsyncStorage.getItem(ACTIVE_CASE_STORAGE_KEY);
            const activeCase = activeCaseRaw
              ? (JSON.parse(activeCaseRaw) as { emergencyId?: string })
              : null;

            if (activeCase?.emergencyId && String(activeCase.emergencyId) === emergencyId) {
              await AsyncStorage.removeItem(ACTIVE_CASE_STORAGE_KEY);
              Alert.alert("Case Closed", payload?.message || "Control-center closed your emergency case.");
              router.replace("/(tabs)/profile");
            }
          } catch {
            // Ignore cleanup failures.
          }
        })();
      });

      socketRef.current.on("disconnect", () => {
        console.log("Socket disconnected");
        setIsConnected(false);
      });

      socketRef.current.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
        reconnectAttemptsRef.current += 1;

        if (connectionModeRef.current === "primary" && config.fallbackSocketUrl && config.fallbackSocketUrl !== config.socketUrl) {
          console.warn("[Socket] Primary backend unreachable. Switching to fallback backend:", config.fallbackSocketUrl);
          connectionModeRef.current = "fallback";
          socketRef.current?.disconnect();
          void connectSocket();
        }
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
      void stopEmergencyAlertSound();
      if (socketRef.current) {
        socketRef.current.off("emergency-nearby-alert");
        socketRef.current.off("emergency-contact-alert");
        socketRef.current.off("emergency-authority-alert");
        socketRef.current.off("emergency-case-closed");
        socketRef.current.disconnect();
      }
      connectionModeRef.current = "primary";
    };
  }, [userDetails?.userId, userDetails?.role, playEmergencyAlertSound, stopEmergencyAlertSound]);

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
