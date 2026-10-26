import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthContext } from "./authContext";
import { getPublicProfile } from "../lib/api";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export type DraftContact = { name: string; phone: string; relation: string; isPrimary: boolean };

export type OnboardingDraft = {
  name: string;
  age: string;
  gender: "" | "male" | "female" | "other";
  bloodGroup: "" | BloodGroup;
  allergies: string[];
  medications: string[];
  diseases: string[];
  notes: string;
  autoShareMedical: boolean;
  contacts: DraftContact[];
  sosMessage: string;
  /** S3 key in the profile bucket, set once the upload succeeded. */
  profilePhotoKey: string;
  /** The profile photo is optional; remember an explicit skip so resume doesn't ask again. */
  profilePhotoSkipped: boolean;
  /** S3 key in the face bucket (always `<userId>.jpg`), set once the upload succeeded. */
  facePhotoKey: string;
  /** ISO timestamp of explicit consent to biometric use of the face photo. */
  faceConsentAt: string;
  enableContinuousTracking: boolean;
};

const EMPTY_DRAFT: OnboardingDraft = {
  name: "",
  age: "",
  gender: "",
  bloodGroup: "",
  allergies: [],
  medications: [],
  diseases: [],
  notes: "",
  autoShareMedical: true,
  contacts: [],
  sosMessage: "",
  profilePhotoKey: "",
  profilePhotoSkipped: false,
  facePhotoKey: "",
  faceConsentAt: "",
  enableContinuousTracking: false,
};

/**
 * Local file URIs of photos taken this session. Kept in memory only:
 * camera cache files are not guaranteed to survive a restart, and the
 * draft in storage should only ever hold S3 keys, never image data.
 */
type Previews = { profile?: string; face?: string };

type DraftContextValue = {
  draft: OnboardingDraft;
  ready: boolean;
  update: (patch: Partial<OnboardingDraft>) => void;
  previews: Previews;
  setPreview: (kind: keyof Previews, uri: string | undefined) => void;
  clear: () => Promise<void>;
};

const DraftContext = createContext<DraftContextValue | null>(null);

const storageKey = (userId: string) => `onboardingDraft:${userId}`;

const stripCountryCode = (phone: string) => phone.replace(/\D/g, "").slice(-10);

export function OnboardingDraftProvider({ children }: { children: ReactNode }) {
  const { userDetails } = useContext(AuthContext);
  const userId = userDetails?.userId ?? "";
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const [previews, setPreviews] = useState<Previews>({});
  const [ready, setReady] = useState(false);
  const hydratedFor = useRef<string | null>(null);

  // Restore an unfinished draft, or prefill from the saved profile when editing.
  useEffect(() => {
    if (!userId || hydratedFor.current === userId) return;
    hydratedFor.current = userId;
    let cancelled = false;

    const hydrate = async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey(userId));
        if (stored) {
          if (!cancelled) setDraft({ ...EMPTY_DRAFT, ...JSON.parse(stored) });
          return;
        }
        if (userDetails?.isprofileComplete) {
          const { profile } = await getPublicProfile();
          if (cancelled || !profile) return;
          const medical = profile.medicalRecord ?? {};
          setDraft({
            ...EMPTY_DRAFT,
            name: profile.name ?? userDetails.name ?? "",
            bloodGroup: (BLOOD_GROUPS as readonly string[]).includes(medical.bloodGroup ?? "")
              ? (medical.bloodGroup as BloodGroup)
              : "",
            allergies: medical.allergies ?? [],
            medications: medical.medications ?? [],
            diseases: medical.diseases ?? [],
            notes: medical.notes ?? "",
            autoShareMedical: profile.autoShareMedical ?? true,
            contacts: (profile.contacts ?? []).map((c: any) => ({
              name: c.name ?? "",
              phone: stripCountryCode(c.phoneNumber ?? ""),
              relation: c.relation ?? "",
              isPrimary: Boolean(c.isPrimary),
            })),
            sosMessage: profile.sosMessage ?? "",
            profilePhotoKey: profile.profileImage && !/^https?:/i.test(profile.profileImage) ? profile.profileImage : "",
            profilePhotoSkipped: !profile.profileImage,
            // A completed profile always has a face photo at this key; the server re-checks it on submit.
            facePhotoKey: `${userId}.jpg`,
            // Consent is re-confirmed on the face step; the server keeps the original timestamp if one exists.
            faceConsentAt: "",
            enableContinuousTracking: Boolean(profile.enableContinuousTracking),
          });
        }
      } catch {
        // Start from an empty draft; nothing to recover.
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [userId, userDetails?.isprofileComplete, userDetails?.name]);

  // Persist every change so going back or restarting the app keeps progress.
  useEffect(() => {
    if (!ready || !userId) return;
    AsyncStorage.setItem(storageKey(userId), JSON.stringify(draft)).catch(() => {});
  }, [draft, ready, userId]);

  const update = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const setPreview = useCallback((kind: keyof Previews, uri: string | undefined) => {
    setPreviews((current) => ({ ...current, [kind]: uri }));
  }, []);

  const clear = useCallback(async () => {
    if (userId) {
      await AsyncStorage.removeItem(storageKey(userId)).catch(() => {});
    }
    setDraft(EMPTY_DRAFT);
    setPreviews({});
  }, [userId]);

  return (
    <DraftContext.Provider value={{ draft, ready, update, previews, setPreview, clear }}>
      {children}
    </DraftContext.Provider>
  );
}

export function useOnboardingDraft() {
  const value = useContext(DraftContext);
  if (!value) {
    throw new Error("useOnboardingDraft must be used inside OnboardingDraftProvider");
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Step definitions and validation                                             */
/* -------------------------------------------------------------------------- */

export const STEPS = [
  { route: "about", label: "About you" },
  { route: "medical", label: "Medical info" },
  { route: "contacts", label: "Emergency contacts" },
  { route: "photo", label: "Profile photo" },
  { route: "face", label: "Face photo" },
  { route: "review", label: "Review" },
] as const;

export type StepRoute = (typeof STEPS)[number]["route"];

export const stepNumber = (route: StepRoute) => STEPS.findIndex((s) => s.route === route) + 1;

export function validateAbout(draft: OnboardingDraft) {
  const errors: { name?: string; age?: string } = {};
  const name = draft.name.trim();
  if (name.length < 2) errors.name = "Enter your name (at least 2 characters).";
  else if (name.length > 50) errors.name = "Keep your name under 50 characters.";
  if (draft.age.trim()) {
    const age = Number(draft.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) errors.age = "Enter an age between 1 and 120.";
  }
  return errors;
}

export function validateMedical(draft: OnboardingDraft) {
  return draft.bloodGroup ? {} : { bloodGroup: "Choose your blood group. Responders need it for transfusions." };
}

export function validateContact(contact: DraftContact) {
  const errors: { name?: string; phone?: string } = {};
  if (contact.name.trim().length < 2) errors.name = "Enter their name.";
  if (!/^[6-9]\d{9}$/.test(contact.phone.replace(/\D/g, ""))) errors.phone = "Enter a valid 10-digit mobile number.";
  return errors;
}

/** First step that still needs input — used to resume onboarding. */
export function firstIncompleteStep(draft: OnboardingDraft): StepRoute {
  if (Object.keys(validateAbout(draft)).length) return "about";
  if (Object.keys(validateMedical(draft)).length) return "medical";
  if (draft.contacts.some((c) => Object.keys(validateContact(c)).length)) return "contacts";
  if (!draft.profilePhotoKey && !draft.profilePhotoSkipped) return "photo";
  if (!draft.facePhotoKey || !draft.faceConsentAt) return "face";
  return "review";
}
