import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { MapPin, ShieldCheck } from "lucide-react";

import { AuthServices } from "@/services";
import { useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuthorityType = "police" | "hospital" | "fire" | "ngo" | "other";

type LocationState = {
  name?: string;
  email?: string;
};

type LatLngLiteral = { lat: number; lng: number };
type LatLngLike = { lat: () => number; lng: () => number };
type MapMouseEvent = { latLng: LatLngLike | null };

type GoogleMap = {
  panTo: (position: LatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  addListener: (eventName: string, handler: (event: MapMouseEvent) => void) => void;
};

type GoogleMarker = {
  getPosition: () => LatLngLike | null;
  setPosition: (position: LatLngLiteral | LatLngLike) => void;
  addListener: (eventName: string, handler: () => void) => void;
};

type GoogleGeocoderResult = {
  formatted_address?: string;
};

type GoogleGeocoder = {
  geocode: (
    request: { location: LatLngLiteral },
    callback: (results: GoogleGeocoderResult[] | null, status: string) => void,
  ) => void;
};

type GoogleMapsNamespace = {
  maps: {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    Geocoder: new () => GoogleGeocoder;
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNamespace;
    __safeSphereGoogleMapsInit?: () => void;
  }
}

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.209 };
const MAP_SCRIPT_ID = "google-maps-js-sdk";
const MAP_CALLBACK = "__safeSphereGoogleMapsInit";
let googleMapsLoader: Promise<void> | null = null;

const loadGoogleMaps = (apiKey: string): Promise<void> => {
  if (typeof window.google?.maps?.Map === "function") {
    return Promise.resolve();
  }

  if (googleMapsLoader) {
    return googleMapsLoader;
  }

  googleMapsLoader = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      delete window.__safeSphereGoogleMapsInit;
    };

    window.__safeSphereGoogleMapsInit = () => {
      if (typeof window.google?.maps?.Map === "function") {
        cleanup();
        resolve();
        return;
      }

      cleanup();
      googleMapsLoader = null;
      reject(new Error("Google Maps SDK loaded incompletely. Check key restrictions and enabled APIs."));
    };

    const existingScript = document.getElementById(MAP_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement("script");
    script.id = MAP_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&v=weekly&callback=${MAP_CALLBACK}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      cleanup();
      googleMapsLoader = null;
      reject(new Error("Failed to load Google Maps SDK."));
    };
    document.head.appendChild(script);
  });

  return googleMapsLoader;
};

function AuthorityProfileCompletion() {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const location = useLocation();
  const user = useAppSelector((state) => state.auth.authData);

  const state = (location.state as LocationState | null) ?? null;
  const [organizationName, setOrganizationName] = useState(state?.name ?? "");
  const [authorityType, setAuthorityType] = useState<AuthorityType>("police");
  const [contactNumber, setContactNumber] = useState("");
  const [officialEmail, setOfficialEmail] = useState(state?.email ?? "");
  const [address, setAddress] = useState("");
  const [officerName, setOfficerName] = useState("");
  const [designation, setDesignation] = useState("");
  const [lat, setLat] = useState(String(DEFAULT_CENTER.lat));
  const [lng, setLng] = useState(String(DEFAULT_CENTER.lng));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);

  const mapsApiKey =
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
    (import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);

  const isControllerCenter = useMemo(() => user?.role === "controller-center", [user?.role]);

  useEffect(() => {
    if (!isControllerCenter) {
      toast.error("Only controller-center can complete authority profiles.");
      navigate("/overview", { replace: true });
      return;
    }

    if (!userId) {
      toast.error("Authority user id is missing.");
      navigate("/add-authority", { replace: true });
      return;
    }

    if (!mapsApiKey) {
      const errorMessage =
        "Map key missing. Add VITE_GOOGLE_MAPS_API_KEY (or PUBLIC_GOOGLE_MAPS_API_KEY) to use map preview.";
      setMapLoadError(errorMessage);
      toast.error(errorMessage);
      return;
    }

    const initializeMap = async () => {
      await loadGoogleMaps(mapsApiKey);
      if (typeof window.google?.maps?.Map !== "function" || !mapContainerRef.current) {
        throw new Error("Google Maps SDK unavailable. Check API key restrictions and enabled APIs.");
      }

      setMapLoadError(null);

      const maps = window.google.maps;

      const center = DEFAULT_CENTER;

      mapRef.current = new maps.Map(mapContainerRef.current, {
        center,
        zoom: 13,
        streetViewControl: false,
        mapTypeControl: false,
      });

      markerRef.current = new maps.Marker({
        position: center,
        map: mapRef.current,
        draggable: true,
      });

      markerRef.current.addListener("dragend", () => {
        const marker = markerRef.current;
        if (!marker) {
          return;
        }

        const position = marker.getPosition();
        if (!position) {
          return;
        }
        setLat(position.lat().toFixed(6));
        setLng(position.lng().toFixed(6));
      });

      mapRef.current.addListener("click", (event: MapMouseEvent) => {
        if (!event.latLng) {
          return;
        }
        const marker = markerRef.current;
        if (!marker) {
          return;
        }

        marker.setPosition(event.latLng);
        setLat(event.latLng.lat().toFixed(6));
        setLng(event.latLng.lng().toFixed(6));
      });
    };

    initializeMap().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to load Google Maps SDK.";
      setMapLoadError(message);
      toast.error(message);
    });
  }, [isControllerCenter, navigate, userId, mapsApiKey]);

  useEffect(() => {
    const latNumber = Number(lat);
    const lngNumber = Number(lng);
    if (!mapRef.current || !markerRef.current || Number.isNaN(latNumber) || Number.isNaN(lngNumber)) {
      return;
    }

    const position = { lat: latNumber, lng: lngNumber };
    markerRef.current.setPosition(position);
    mapRef.current.panTo(position);

    if (window.google?.maps?.Geocoder) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: position }, (results, status) => {
        if (status === "OK" && results && results.length > 0) {
          const formattedAddress = results[0]?.formatted_address;
          if (formattedAddress) {
            setAddress(formattedAddress);
          }
        }
      });
    }
  }, [lat, lng]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!userId) {
      toast.error("Authority user id is missing.");
      return;
    }

    const latNumber = Number(lat);
    const lngNumber = Number(lng);

    if (Number.isNaN(latNumber) || Number.isNaN(lngNumber)) {
      toast.error("Please provide valid coordinates.");
      return;
    }

    if (!organizationName.trim() || !officialEmail.trim() || !contactNumber.trim() || !address.trim()) {
      toast.error("Please complete the required profile fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      await AuthServices.adminCreateAuthorityProfile({
        userId,
        organizationName: organizationName.trim(),
        authorityType,
        contactNumber: contactNumber.trim(),
        officialEmail: officialEmail.trim(),
        address: address.trim(),
        location: {
          lat: latNumber,
          lng: lngNumber,
        },
        officerName: officerName.trim() || undefined,
        designation: designation.trim() || undefined,
      });

      toast.success("Authority profile completed successfully.");
      navigate("/add-authority", { replace: true });
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
          ?.message === "string"
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response!.data!
              .message!
          : typeof error === "object" &&
              error !== null &&
              "response" in error &&
              typeof (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
                ?.error === "string"
            ? (error as { response?: { data?: { error?: string; message?: string } } }).response!.data!.error!
            : "Failed to complete authority profile.";

      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="p-6">
      <section className="mx-auto max-w-6xl space-y-6 rounded-xl border border-border bg-card/70 p-6 backdrop-blur">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-500">Authority Provisioning</p>
          <h1 className="text-2xl font-semibold text-foreground">Complete Authority Profile</h1>
          <p className="text-sm text-muted-foreground">
            Fill all operational details and place the exact authority location using map coordinates.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-lg border border-border/80 bg-background/60 p-4">
            <h2 className="text-sm font-semibold text-foreground">Organization</h2>
            <Input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Organization name"
              required
            />
            <Select value={authorityType} onValueChange={(value) => setAuthorityType(value as AuthorityType)}>
              <SelectTrigger>
                <SelectValue placeholder="Authority type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="police">Police</SelectItem>
                <SelectItem value="hospital">Hospital</SelectItem>
                <SelectItem value="fire">Fire</SelectItem>
                <SelectItem value="ngo">NGO</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={officialEmail}
              onChange={(event) => setOfficialEmail(event.target.value)}
              placeholder="Official email"
              type="email"
              required
            />
            <Input
              value={contactNumber}
              onChange={(event) => setContactNumber(event.target.value)}
              placeholder="Contact number"
              required
            />
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Official address"
              required
            />
          </div>

          <div className="space-y-4 rounded-lg border border-border/80 bg-background/60 p-4">
            <h2 className="text-sm font-semibold text-foreground">Officer Details</h2>
            <Input
              value={officerName}
              onChange={(event) => setOfficerName(event.target.value)}
              placeholder="Officer name"
            />
            <Input
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              placeholder="Designation"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border/80 bg-background/60 p-4 lg:col-span-2">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="grid w-full grid-cols-2 gap-2">
                <Input value={lat} onChange={(event) => setLat(event.target.value)} placeholder="Latitude" />
                <Input value={lng} onChange={(event) => setLng(event.target.value)} placeholder="Longitude" />
              </div>
            </div>
            {mapLoadError && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {mapLoadError} You can still submit using manual latitude/longitude and address.
              </p>
            )}
            <div
              ref={mapContainerRef}
              className="h-80 w-full overflow-hidden rounded-md border border-emerald-500/30"
            />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> Drag marker or click map to set exact authority position.
            </p>
          </div>

          <div className="lg:col-span-2">
            <Button type="submit" disabled={isSubmitting} className="w-full">
              <ShieldCheck className="mr-2 size-4" />
              {isSubmitting ? "Submitting Profile..." : "Submit Authority Profile"}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default AuthorityProfileCompletion;
