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

type DocumentItem = {
  name: string;
  url: string;
};

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

type GoogleAutocompletePlace = {
  formatted_address?: string;
  geometry?: {
    location?: LatLngLike;
  };
};

type GoogleAutocomplete = {
  getPlace: () => GoogleAutocompletePlace;
  addListener: (eventName: string, handler: () => void) => void;
};

type GoogleMapsNamespace = {
  maps: {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    places: {
      Autocomplete: new (input: HTMLInputElement, options: Record<string, unknown>) => GoogleAutocomplete;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNamespace;
  }
}

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.209 };

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
  const [jurisdiction, setJurisdiction] = useState("");
  const [lat, setLat] = useState(String(DEFAULT_CENTER.lat));
  const [lng, setLng] = useState(String(DEFAULT_CENTER.lng));
  const [documents, setDocuments] = useState<DocumentItem[]>([{ name: "", url: "" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const autocompleteRef = useRef<GoogleAutocomplete | null>(null);

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

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!apiKey) {
      toast.error("Missing VITE_GOOGLE_MAPS_API_KEY. Map features are unavailable.");
      return;
    }

    const initializeMap = () => {
      if (!window.google?.maps || !mapContainerRef.current || !searchInputRef.current) {
        return;
      }

      const maps = window.google.maps;

      const center = {
        lat: Number(lat) || DEFAULT_CENTER.lat,
        lng: Number(lng) || DEFAULT_CENTER.lng,
      };

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

      autocompleteRef.current = new maps.places.Autocomplete(searchInputRef.current, {
        fields: ["formatted_address", "geometry"],
      });

      autocompleteRef.current.addListener("place_changed", () => {
        const autocomplete = autocompleteRef.current;
        if (!autocomplete) {
          return;
        }

        const place = autocomplete.getPlace();
        const placeLocation = place?.geometry?.location;
        if (!placeLocation) {
          return;
        }

        const nextPosition = {
          lat: placeLocation.lat(),
          lng: placeLocation.lng(),
        };

        const map = mapRef.current;
        const marker = markerRef.current;
        if (!map || !marker) {
          return;
        }

        map.panTo(nextPosition);
        map.setZoom(15);
        marker.setPosition(nextPosition);

        setLat(nextPosition.lat.toFixed(6));
        setLng(nextPosition.lng.toFixed(6));
        if (typeof place.formatted_address === "string") {
          setAddress(place.formatted_address);
        }
      });
    };

    if (window.google?.maps?.places) {
      initializeMap();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = initializeMap;
    script.onerror = () => {
      toast.error("Failed to load Google Maps SDK.");
    };
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [isControllerCenter, lat, lng, navigate, userId]);

  useEffect(() => {
    const latNumber = Number(lat);
    const lngNumber = Number(lng);
    if (!mapRef.current || !markerRef.current || Number.isNaN(latNumber) || Number.isNaN(lngNumber)) {
      return;
    }

    const position = { lat: latNumber, lng: lngNumber };
    markerRef.current.setPosition(position);
    mapRef.current.panTo(position);
  }, [lat, lng]);

  const updateDocument = (index: number, field: keyof DocumentItem, value: string) => {
    setDocuments((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    );
  };

  const addDocument = () => {
    setDocuments((current) => [...current, { name: "", url: "" }]);
  };

  const removeDocument = (index: number) => {
    setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

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

    const normalizedDocuments = documents
      .map((document) => ({ name: document.name.trim(), url: document.url.trim() }))
      .filter((document) => document.name.length > 0 && document.url.length > 0);

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
        jurisdiction: jurisdiction.trim() || undefined,
        documents: normalizedDocuments,
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
            Fill all operational details and place the exact authority location using map search or marker drag.
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
            <Input
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value)}
              placeholder="Jurisdiction (optional)"
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
            <h2 className="pt-2 text-sm font-semibold text-foreground">Documents</h2>
            {documents.map((document, index) => (
              <div key={`${index}-${document.name}`} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={document.name}
                  onChange={(event) => updateDocument(index, "name", event.target.value)}
                  placeholder="Document name"
                />
                <Input
                  value={document.url}
                  onChange={(event) => updateDocument(index, "url", event.target.value)}
                  placeholder="https://..."
                  type="url"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => removeDocument(index)}
                  disabled={documents.length === 1}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addDocument} className="w-full">
              Add Document
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border border-border/80 bg-background/60 p-4 lg:col-span-2">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="md:w-2/3">
                <Input ref={searchInputRef} placeholder="Search place with Google Places" />
              </div>
              <div className="grid w-full grid-cols-2 gap-2 md:w-1/3">
                <Input value={lat} onChange={(event) => setLat(event.target.value)} placeholder="Latitude" />
                <Input value={lng} onChange={(event) => setLng(event.target.value)} placeholder="Longitude" />
              </div>
            </div>
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
