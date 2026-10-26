import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";

import { AuthContext } from "./authContext";
import { config } from "../lib/config";
import { acceptEmergencyResponse, getApiErrorMessage } from "../lib/api";
import { EMERGENCY_TYPE_LABELS, SEVERITY_LABELS, type EmergencySeverity, type EmergencyType } from "../lib/emergencyTypes";

type Listener = (data: any) => void;

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  emit: (event: string, data?: any) => void;
  /** Listeners are kept in a registry, so they survive reconnects and can be added before connecting. */
  on: (event: string, callback: Listener) => void;
  off: (event: string, callback?: Listener) => void;
}

export const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  emit: () => {},
  on: () => {},
  off: () => {},
});

/** Subscribe to a socket event for the lifetime of the component. */
export function useSocketEvent(event: string, handler: Listener) {
  const { on, off } = useContext(SocketContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener: Listener = (data) => handlerRef.current(data);
    on(event, listener);
    return () => off(event, listener);
  }, [event, on, off]);
}

type AlertPayload = {
  emergencyId?: string;
  title?: string;
  type?: EmergencyType;
  severity?: EmergencySeverity;
  message?: string;
  audience?: string;
};

const describeAlert = (payload: AlertPayload) => {
  const parts = [
    payload.type ? EMERGENCY_TYPE_LABELS[payload.type] : null,
    payload.severity ? `${SEVERITY_LABELS[payload.severity]} severity` : null,
  ].filter(Boolean);
  return [payload.title, parts.join(" · "), payload.message].filter(Boolean).join("\n");
};

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { userDetails } = useContext(AuthContext);
  const connectionModeRef = useRef<"primary" | "fallback">("primary");
  const currentAlertSoundRef = useRef<Audio.Sound | null>(null);
  const listenersRef = useRef(new Map<string, Set<Listener>>());

  const dispatch = useCallback((event: string, payload: any) => {
    const listeners = listenersRef.current.get(event);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      try {
        listener(payload);
      } catch (error) {
        console.warn(`[Socket] listener for ${event} failed`, error);
      }
    }
  }, []);

  const on = useCallback((event: string, callback: Listener) => {
    const set = listenersRef.current.get(event) ?? new Set<Listener>();
    set.add(callback);
    listenersRef.current.set(event, set);
  }, []);

  const off = useCallback((event: string, callback?: Listener) => {
    if (!callback) {
      listenersRef.current.delete(event);
      return;
    }
    listenersRef.current.get(event)?.delete(callback);
  }, []);

  const emit = useCallback((event: string, data?: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    } else {
      console.warn("Socket not connected. Event not sent:", event);
    }
  }, []);

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

    const role = userDetails.role;

    const handleEmergencyAlert = (payload: AlertPayload) => {
      const emergencyId = String(payload?.emergencyId || "");
      if (!emergencyId) return;

      void playEmergencyAlertSound();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      const isContact = payload.audience === "contact";
      const canOffer = role === "public" || role === "volunteer";
      const stop = () => void stopEmergencyAlertSound();
      const openCase = (autoJoin = false) =>
        router.push({ pathname: "/case", params: { emergencyId, ...(autoJoin ? { autoJoin: "1" } : {}) } });

      const acceptAndOpen = async () => {
        await stopEmergencyAlertSound();
        try {
          // The server needs our position to confirm we are close enough to help.
          const position = await Location.getLastKnownPositionAsync().catch(() => null);
          await acceptEmergencyResponse(
            emergencyId,
            position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null,
          );
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          openCase();
        } catch (error) {
          Alert.alert("Couldn't join this emergency", getApiErrorMessage(error));
        }
      };

      Alert.alert(
        isContact ? "Your contact needs help" : "Emergency near you",
        describeAlert(payload),
        canOffer
          ? [
              { text: "Not now", style: "cancel", onPress: stop },
              { text: "View details", onPress: () => { stop(); openCase(); } },
              { text: "I can help", onPress: () => void acceptAndOpen() },
            ]
          : [{ text: "View", onPress: () => { stop(); openCase(); } }],
        { cancelable: true, onDismiss: stop },
      );
    };

    const handleCaseClosed = (payload: { emergencyId?: string; message?: string }) => {
      void stopEmergencyAlertSound();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (payload?.message) {
        Alert.alert("Emergency closed", payload.message);
      }
    };

    // Alerts are handled here for the whole app; screens subscribe through `on` / useSocketEvent.
    on("emergency-nearby-alert", handleEmergencyAlert);
    on("emergency-contact-alert", handleEmergencyAlert);
    on("emergency-case-closed", handleCaseClosed);

    const connectSocket = async () => {
      const token = await AsyncStorage.getItem("authToken");
      if (!token || !isMounted) {
        return;
      }

      const SOCKET_URL = connectionModeRef.current === "fallback" ? config.fallbackSocketUrl : config.socketUrl;
      const nextSocket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        // Keep trying: an emergency app must come back on its own after a dead zone.
        reconnectionAttempts: Infinity,
        transports: ["websocket", "polling"],
        timeout: 20000,
        auth: { token },
      });
      socketRef.current = nextSocket;
      setSocket(nextSocket);

      nextSocket.onAny((event: string, payload: any) => dispatch(event, payload));

      nextSocket.on("connect", () => {
        setIsConnected(true);
        dispatch("connect", undefined);
      });

      nextSocket.on("disconnect", () => {
        setIsConnected(false);
      });

      nextSocket.on("connect_error", (error) => {
        console.warn("Socket connection error:", error?.message);
        if (connectionModeRef.current === "primary" && config.fallbackSocketUrl && config.fallbackSocketUrl !== config.socketUrl) {
          console.warn("[Socket] Primary backend unreachable. Switching to fallback backend:", config.fallbackSocketUrl);
          connectionModeRef.current = "fallback";
          nextSocket.removeAllListeners();
          nextSocket.disconnect();
          void connectSocket();
        }
      });
    };

    void connectSocket();

    return () => {
      isMounted = false;
      void stopEmergencyAlertSound();
      off("emergency-nearby-alert", handleEmergencyAlert);
      off("emergency-contact-alert", handleEmergencyAlert);
      off("emergency-case-closed", handleCaseClosed);
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
      connectionModeRef.current = "primary";
    };
  }, [userDetails?.userId, userDetails?.role, dispatch, on, off, playEmergencyAlertSound, stopEmergencyAlertSound]);

  const value = useMemo(() => ({ socket, isConnected, emit, on, off }), [socket, isConnected, emit, on, off]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};
