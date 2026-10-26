import { useCallback, useContext, useRef } from "react";
import { DeviceEventEmitter } from "react-native";
import { usePathname } from "expo-router";

import { AuthContext } from "../context/authContext";
import useShakeSOS from "../hooks/useShakeSOS";
import { VOICE_SOS_EVENT } from "./global-shake-voice-sos";

/** Mounted once in the root layout: a strong shake starts the voice SOS from any signed-in screen. */
export default function ShakeSOSListener() {
  const { isAuthenticated, userDetails } = useContext(AuthContext);
  const pathname = usePathname();

  // Read through refs so the callback (and the accelerometer subscription) stays the same across
  // navigation; re-subscribing on every screen change reset the shake counter mid-gesture.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const lastTriggerTimeRef = useRef(0);

  const handleShakeDetected = useCallback(() => {
    if (pathnameRef.current.startsWith("/auth") || pathnameRef.current.startsWith("/onboarding")) {
      return;
    }
    const now = Date.now();
    if (now - lastTriggerTimeRef.current < 5000) {
      return;
    }
    lastTriggerTimeRef.current = now;
    DeviceEventEmitter.emit(VOICE_SOS_EVENT, { source: "shake" });
  }, []);

  useShakeSOS(handleShakeDetected, Boolean(isAuthenticated && userDetails?.userId));

  return null;
}
