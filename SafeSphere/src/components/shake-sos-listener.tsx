import { useCallback, useContext, useRef } from "react";
import { DeviceEventEmitter } from "react-native";
import { usePathname } from "expo-router";

import { AuthContext } from "../context/authContext";
import useShakeSOS from "../hooks/useShakeSOS";

export default function ShakeSOSListener() {
  const { isAuthenticated, userDetails } = useContext(AuthContext);
  const pathname = usePathname();

  const lastTriggerTimeRef = useRef(0);

  const handleShakeDetected = useCallback(() => {
    void (async () => {
      if (!isAuthenticated || !userDetails?.userId) {
        return;
      }

      if (pathname.startsWith("/auth")) {
        return;
      }

      const now = Date.now();
      if (now - lastTriggerTimeRef.current < 5000) {
        return;
      }

      lastTriggerTimeRef.current = now;
      DeviceEventEmitter.emit("voice-sos-start-requested");
    })();
  }, [isAuthenticated, pathname, userDetails?.userId]);

  useShakeSOS(handleShakeDetected, Boolean(isAuthenticated && userDetails?.userId));

  return null;
}
