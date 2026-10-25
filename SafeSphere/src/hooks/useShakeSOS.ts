  import { Accelerometer } from "expo-sensors";
import { useEffect, useRef } from "react";

type ShakeCallback = () => void;

export default function useShakeSOS(onShakeDetected: ShakeCallback, enabled = true) {
  const shakeCount = useRef(0);
  const lastShakeTime = useRef(0);
  const lastPeakTime = useRef(0);
  const lastDetectedAt = useRef(0);

  // For low-pass filtering gravity and extracting linear acceleration.
  const gravity = useRef({ x: 0, y: 0, z: 0 });

  const SHAKE_THRESHOLD = 1.8;
  const SHAKE_WINDOW = 1600;
  const REQUIRED_SHAKES = 5;
  const MIN_PEAK_GAP_MS = 180;
  const DETECTION_COOLDOWN_MS = 6000;
  const ALPHA = 0.82;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let mounted = true;
    let subscription: { remove: () => void } | null = null;

    const attach = async () => {
      const isAvailable = await Accelerometer.isAvailableAsync();
      if (!mounted || !isAvailable) {
        return;
      }

      Accelerometer.setUpdateInterval(80);

      subscription = Accelerometer.addListener(({ x, y, z }) => {
        const now = Date.now();

        // Cooldown after successful SOS trigger to avoid re-fire loops.
        if (now - lastDetectedAt.current < DETECTION_COOLDOWN_MS) {
          return;
        }

        // Low-pass gravity and derive linear acceleration for cleaner shake peaks.
        gravity.current.x = ALPHA * gravity.current.x + (1 - ALPHA) * x;
        gravity.current.y = ALPHA * gravity.current.y + (1 - ALPHA) * y;
        gravity.current.z = ALPHA * gravity.current.z + (1 - ALPHA) * z;

        const lx = x - gravity.current.x;
        const ly = y - gravity.current.y;
        const lz = z - gravity.current.z;
        const linearForce = Math.sqrt(lx * lx + ly * ly + lz * lz);

        if (linearForce <= SHAKE_THRESHOLD) {
          return;
        }

        // Debounce peaks so one physical jerk does not count multiple times.
        if (now - lastPeakTime.current < MIN_PEAK_GAP_MS) {
          return;
        }
        lastPeakTime.current = now;

        if (now - lastShakeTime.current < SHAKE_WINDOW) {
          shakeCount.current += 1;
        } else {
          shakeCount.current = 1;
        }

        lastShakeTime.current = now;

        if (shakeCount.current >= REQUIRED_SHAKES) {
          shakeCount.current = 0;
          lastDetectedAt.current = now;
          onShakeDetected();
        }
      });
    };

    void attach();

    return () => {
      mounted = false;
      if (subscription) {
        subscription.remove();
      }
    };
  }, [enabled, onShakeDetected]);
}
