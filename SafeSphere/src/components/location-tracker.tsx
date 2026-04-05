import { useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AuthContext } from "../context/authContext";
import { getPublicProfile } from "../lib/api";
import { useLocationTracking } from "../lib/useLocationTracking";

const TRACKING_PREF_KEY = "enableContinuousTracking";

export default function LocationTracker() {
  const { userDetails } = useContext(AuthContext);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadTrackingState = async () => {
      if (!userDetails?.userId) {
        if (mounted) {
          setEnabled(false);
        }
        return;
      }

      try {
        const stored = await AsyncStorage.getItem(TRACKING_PREF_KEY);
        if (stored === "true" || stored === "false") {
          if (mounted) {
            setEnabled(stored === "true");
          }
          return;
        }

        const response = await getPublicProfile();
        const fromProfile = Boolean(response?.profile?.enableContinuousTracking);
        await AsyncStorage.setItem(TRACKING_PREF_KEY, String(fromProfile));

        if (mounted) {
          setEnabled(fromProfile);
        }
      } catch (error) {
        console.warn("[LocationTracker] Unable to load tracking preference", error);
      }
    };

    void loadTrackingState();

    return () => {
      mounted = false;
    };
  }, [userDetails?.userId]);

  useLocationTracking({
    enableTracking: enabled && Boolean(userDetails?.userId),
    intervalSeconds: 20,
    debug: true,
  });

  return null;
}
