import { useState, useEffect } from "react";
import { AuthServices } from "@/services";

/**
 * Hook to fetch and cache presigned URLs for profile images
 * @param imageKey - The S3 key of the profile image (or null to skip)
 * @returns The presigned URL (or null if loading/error)
 */
export const useProfileImage = (imageKey: string | null | undefined) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!imageKey) {
      setImageUrl(null);
      return;
    }

    // Check if URL is already a full HTTP URL (already signed)
    if (imageKey.startsWith("http://") || imageKey.startsWith("https://")) {
      setImageUrl(imageKey);
      return;
    }

    const fetchPresignedUrl = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = await AuthServices.getPresignedReadUrl(imageKey);
        setImageUrl(url);
      } catch (err) {
        console.error("Failed to fetch presigned URL:", err);
        setError(err instanceof Error ? err : new Error("Failed to fetch presigned URL"));
        setImageUrl(null);
      } finally {
        setLoading(false);
      }
    };

    fetchPresignedUrl();
  }, [imageKey]);

  return { imageUrl, loading, error };
};
