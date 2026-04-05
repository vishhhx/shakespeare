import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname } from "expo-router";

const ACTIVE_CASE_STORAGE_KEY = "activeEmergencyCase";

export default function CaseResumeGuard() {
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;

    const restoreCase = async () => {
      if (pathname === "/case" || pathname.startsWith("/auth")) {
        return;
      }

      const stored = await AsyncStorage.getItem(ACTIVE_CASE_STORAGE_KEY);
      if (!stored || !mounted) {
        return;
      }

      try {
        const parsed = JSON.parse(stored) as { emergencyId?: string };
        if (parsed?.emergencyId) {
          router.replace({ pathname: "/case", params: { emergencyId: parsed.emergencyId } });
        }
      } catch {
        // Ignore invalid cached case payload.
      }
    };

    void restoreCase();

    return () => {
      mounted = false;
    };
  }, [pathname]);

  return null;
}
