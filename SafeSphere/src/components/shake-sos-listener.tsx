import { useCallback, useContext, useRef } from "react";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname } from "expo-router";

import { AuthContext } from "../context/authContext";
import useShakeSOS from "../hooks/useShakeSOS";

const ACTIVE_CASE_STORAGE_KEY = "activeEmergencyCase";
const VOICE_SOS_AUTO_START_KEY = "voiceSOSAutoStart";

export default function ShakeSOSListener() {
  const { isAuthenticated, userDetails } = useContext(AuthContext);
  const pathname = usePathname();

  const promptOpenRef = useRef(false);
  const lastPromptTimeRef = useRef(0);

  const handleShakeDetected = useCallback(() => {
    void (async () => {
      if (!isAuthenticated || !userDetails?.userId) {
        return;
      }

      if (pathname.startsWith("/auth")) {
        return;
      }

      const now = Date.now();
      if (promptOpenRef.current || now - lastPromptTimeRef.current < 5000) {
        return;
      }

      const activeCaseRaw = await AsyncStorage.getItem(ACTIVE_CASE_STORAGE_KEY);
      if (activeCaseRaw) {
        try {
          const activeCase = JSON.parse(activeCaseRaw) as { emergencyId?: string };
          if (activeCase?.emergencyId) {
            router.replace({ pathname: "/case", params: { emergencyId: activeCase.emergencyId } });
            return;
          }
        } catch {
          // Ignore invalid cached case.
        }
      }

      promptOpenRef.current = true;
      lastPromptTimeRef.current = now;

      Alert.alert(
        "Shake SOS Detected",
        "Open Voice SOS mic now for emergency capture?",
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              promptOpenRef.current = false;
            },
          },
          {
            text: "Start Voice SOS",
            onPress: () => {
              void (async () => {
                await AsyncStorage.setItem(VOICE_SOS_AUTO_START_KEY, String(Date.now()));
                promptOpenRef.current = false;
                router.replace("/(tabs)/emergency");
              })();
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => {
            promptOpenRef.current = false;
          },
        },
      );
    })();
  }, [isAuthenticated, pathname, userDetails?.userId]);

  useShakeSOS(handleShakeDetected, Boolean(isAuthenticated && userDetails?.userId));

  return null;
}
