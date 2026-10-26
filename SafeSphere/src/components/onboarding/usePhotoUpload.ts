import { useCallback, useRef, useState } from "react";
import { getApiErrorMessage, uploadImage } from "../../lib/api";

type Status = "idle" | "uploading" | "done" | "error";

/** Upload state for one photo, with retry of the last attempt. */
export function usePhotoUpload(bucket: "profile" | "face") {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const lastAttempt = useRef<{ uri: string; key: string } | null>(null);

  const upload = useCallback(
    async (uri: string, key: string) => {
      lastAttempt.current = { uri, key };
      setStatus("uploading");
      setError("");
      try {
        const storedKey = await uploadImage({ uri, bucket, key });
        setStatus("done");
        return storedKey;
      } catch (err) {
        setStatus("error");
        setError(getApiErrorMessage(err, "The photo didn't upload. Please try again."));
        return null;
      }
    },
    [bucket],
  );

  const retry = useCallback(async () => {
    if (!lastAttempt.current) return null;
    return upload(lastAttempt.current.uri, lastAttempt.current.key);
  }, [upload]);

  const reset = useCallback(() => {
    lastAttempt.current = null;
    setStatus("idle");
    setError("");
  }, []);

  return { status, error, upload, retry, reset };
}
