// Loads the Google Maps JavaScript API once per page (key: VITE_GOOGLE_MAPS_API_KEY).
let loading: Promise<typeof google.maps> | null = null;

export const mapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || "";

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window !== "undefined" && window.google?.maps?.Map) {
    return Promise.resolve(window.google!.maps);
  }
  if (loading) return loading;
  if (!mapsApiKey) {
    return Promise.reject(new Error("Google Maps is not configured (VITE_GOOGLE_MAPS_API_KEY)."));
  }

  loading = new Promise((resolve, reject) => {
    const callbackName = "__safesphereMapsReady";
    (window as unknown as Record<string, () => void>)[callbackName] = () => resolve(window.google!.maps);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("Google Maps failed to load. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return loading;
}
