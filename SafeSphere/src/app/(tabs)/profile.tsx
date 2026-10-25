import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useCallback, useContext, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AuthContext } from "../../context/authContext";
import { useLocationTracking } from "../../lib/useLocationTracking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPublicProfile } from "../../lib/api";

type PublicProfile = {
  name?: string;
  phoneNumber?: string;
  profileImage?: string;
  profileImageSignedUrl?: string;
  userType?: "medical" | "fire" | "police" | "ngo" | "other";

  contacts?: Array<{
    name: string;
    phoneNumber: string;
    relation?: string;
  }>;

  medicalRecord?: {
    bloodGroup?: string;
    allergies?: string[];
    medications?: string[];
    diseases?: string[];
    notes?: string;
  };

  sosMessage?: string;

  autoShareMedical?: boolean;
  enableContinuousTracking?: boolean;

  gamification?: {
    points: number;
  };

  accountStatus?: {
    isPermanentlyBlocked: boolean;
    fraudFlagCount: number;
    permanentlyBlockedAt?: string | null;
    permanentBlockReason?: string;
  };
};

/* -------------------------------------------------------------------------- */
/* Theme                                                                       */
/* -------------------------------------------------------------------------- */

const COLORS = {
  background: "#FFFBF8",
  surface: "#FFFFFF",
  surfaceSoft: "#FFF8F3",

  primary: "#FF7A1A",
  primaryDark: "#EA5B0C",
  primarySoft: "#FFF4E8",
  primaryBorder: "#F8D5BA",

  text: "#2A1B12",
  textSecondary: "#725E50",
  textMuted: "#9A887C",

  border: "#E8DED7",
  divider: "#F1EAE5",

  success: "#16A34A",
  successSoft: "#F0FDF4",
  successBorder: "#BBF7D0",

  danger: "#DC2626",
  dangerSoft: "#FEF2F2",
  dangerBorder: "#FECACA",

  warning: "#B45309",
  warningSoft: "#FFFBEB",
  warningBorder: "#FDE68A",
};

/* -------------------------------------------------------------------------- */
/* User type                                                                   */
/* -------------------------------------------------------------------------- */

const USER_TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  fire: "Fire Services",
  police: "Police",
  ngo: "NGO",
  other: "Public",
};

/* -------------------------------------------------------------------------- */
/* Simple section header                                                       */
/* -------------------------------------------------------------------------- */

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text className="text-[17px] font-bold text-[#2A1B12]">{title}</Text>

      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text className="text-[12px] font-semibold text-[#EA5B0C]">
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Information row                                                             */
/* -------------------------------------------------------------------------- */

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const empty = !value || value === "N/A" || value === "None";

  return (
    <View
      className={`flex-row items-start justify-between py-3.5 ${
        last ? "" : "border-b border-[#F1EAE5]"
      }`}
    >
      <Text className="flex-1 text-[13px] text-[#9A887C]">{label}</Text>

      <Text
        className={`flex-[1.7] text-right text-[13px] font-medium ${
          empty ? "text-[#C2B5AC]" : "text-[#2A1B12]"
        }`}
      >
        {value || "Not provided"}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Main profile screen                                                         */
/* -------------------------------------------------------------------------- */

export default function ProfileTab() {
  const { userDetails, logout } = useContext(AuthContext);

  const [trackingEnabled, setTrackingEnabled] = useState(false);

  const [loadingProfile, setLoadingProfile] = useState(true);

  const [refreshingProfile, setRefreshingProfile] = useState(false);

  const [profileError, setProfileError] = useState("");

  const [profile, setProfile] = useState<PublicProfile | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Tracking preference                                                     */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const loadTrackingPreference = async () => {
      try {
        const enabled = await AsyncStorage.getItem("enableContinuousTracking");

        setTrackingEnabled(enabled === "true");
      } catch (err) {
        console.error("Error loading tracking preference:", err);
      }
    };

    void loadTrackingPreference();
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Profile                                                                  */
  /* ---------------------------------------------------------------------- */

  const fetchProfile = useCallback(async (manualRefresh = false) => {
    try {
      if (manualRefresh) {
        setRefreshingProfile(true);
      } else {
        setLoadingProfile(true);
      }

      setProfileError("");

      const response = await getPublicProfile();

      setProfile({
        ...(response?.profile ?? {}),
        gamification: response?.gamification,
        accountStatus: response?.accountStatus,
      });
    } catch (error: any) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        "Unable to load profile";

      setProfileError(message);
    } finally {
      setLoadingProfile(false);
      setRefreshingProfile(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile(false);
  }, [fetchProfile]);

  /* ---------------------------------------------------------------------- */
  /* Location tracking                                                       */
  /* ---------------------------------------------------------------------- */

  const {
    isTracking,
    lastUpdateTime,
    error: trackingError,
  } = useLocationTracking({
    enableTracking: trackingEnabled,
    intervalSeconds: 30,
    debug: true,
  });

  const toggleTracking = async () => {
    try {
      const nextValue = !trackingEnabled;

      await AsyncStorage.setItem("enableContinuousTracking", String(nextValue));

      setTrackingEnabled(nextValue);
    } catch (err) {
      console.error("Error toggling tracking:", err);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Derived values                                                          */
  /* ---------------------------------------------------------------------- */

  const isBlocked = profile?.accountStatus?.isPermanentlyBlocked === true;

  const displayName = profile?.name || userDetails?.name || "Your Profile";

  const displayPhone =
    profile?.phoneNumber ||
    userDetails?.phoneNumber ||
    "Phone number unavailable";

  const profileImage =
    profile?.profileImageSignedUrl ||
    profile?.profileImage ||
    userDetails?.avatarUrl;

  const points = profile?.gamification?.points ?? 0;

  const contacts = profile?.contacts ?? [];

  const userType = profile?.userType
    ? (USER_TYPE_LABELS[profile.userType] ?? profile.userType)
    : null;

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <View
      className="flex-1"
      style={{
        backgroundColor: COLORS.background,
      }}
    >
      {/* ================================================================== */}
      {/* Header                                                              */}
      {/* ================================================================== */}

      <View
        className="border-b px-5 pb-4 pt-14"
        style={{
          backgroundColor: COLORS.surface,
          borderBottomColor: COLORS.divider,
        }}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text
              className="text-[12px] font-semibold"
              style={{
                color: COLORS.textSecondary,
              }}
            >
              Account
            </Text>

            <Text
              className="mt-0.5 text-[27px] font-bold tracking-tight"
              style={{
                color: COLORS.text,
              }}
            >
              Profile
            </Text>
          </View>

          <Pressable
            onPress={() => void fetchProfile(true)}
            disabled={refreshingProfile}
            className="h-10 w-10 items-center justify-center rounded-full border"
            style={{
              borderColor: COLORS.primaryBorder,
              backgroundColor: COLORS.primarySoft,
            }}
            hitSlop={8}
          >
            {refreshingProfile ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons
                name="refresh-outline"
                size={18}
                color={COLORS.primaryDark}
              />
            )}
          </Pressable>
        </View>
      </View>

      {/* ================================================================== */}
      {/* Content                                                             */}
      {/* ================================================================== */}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 22,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ================================================================ */}
        {/* Profile identity                                                  */}
        {/* ================================================================ */}

        <View className="flex-row items-center">
          {/* Avatar */}

          <View
            className="h-[78px] w-[78px] items-center justify-center rounded-full border-2 p-1"
            style={{
              borderColor: COLORS.primary,
              backgroundColor: COLORS.primarySoft,
            }}
          >
            {profileImage ? (
              <Image
                source={{
                  uri: profileImage,
                }}
                className="h-full w-full rounded-full"
              />
            ) : (
              <View className="h-full w-full items-center justify-center rounded-full">
                <Ionicons
                  name="person-outline"
                  size={30}
                  color={COLORS.primaryDark}
                />
              </View>
            )}
          </View>

          {/* Identity */}

          <View className="ml-4 flex-1">
            <Text
              className="text-[21px] font-bold"
              style={{
                color: COLORS.text,
              }}
              numberOfLines={1}
            >
              {displayName}
            </Text>

            <Text
              className="mt-1 text-[13px]"
              style={{
                color: COLORS.textSecondary,
              }}
            >
              {displayPhone}
            </Text>

            <View className="mt-2 flex-row items-center">
              <View
                className="mr-1.5 h-2 w-2 rounded-full"
                style={{
                  backgroundColor: isBlocked ? COLORS.danger : COLORS.success,
                }}
              />

              <Text
                className="text-[11px] font-medium"
                style={{
                  color: isBlocked ? COLORS.danger : COLORS.success,
                }}
              >
                {isBlocked ? "Account restricted" : "Account active"}
              </Text>
            </View>
          </View>
        </View>

        {/* User type */}

        {userType && (
          <View className="mt-4 self-start rounded-md bg-[#F7F3EF] px-2.5 py-1">
            <Text
              className="text-[10px] font-semibold uppercase tracking-[1px]"
              style={{
                color: COLORS.textSecondary,
              }}
            >
              {userType}
            </Text>
          </View>
        )}

        {/* ================================================================ */}
        {/* Quick information                                                */}
        {/* ================================================================ */}

        <View
          className="mt-6 flex-row border-y py-4"
          style={{
            borderColor: COLORS.divider,
          }}
        >
          <View className="flex-1">
            <Text
              className="text-[20px] font-bold"
              style={{
                color: COLORS.text,
              }}
            >
              {points}
            </Text>

            <Text
              className="mt-0.5 text-[11px]"
              style={{
                color: COLORS.textMuted,
              }}
            >
              Points
            </Text>
          </View>

          <View
            className="w-px"
            style={{
              backgroundColor: COLORS.divider,
            }}
          />

          <View className="flex-1 pl-5">
            <Text
              className="text-[20px] font-bold"
              style={{
                color: COLORS.text,
              }}
            >
              {contacts.length}
            </Text>

            <Text
              className="mt-0.5 text-[11px]"
              style={{
                color: COLORS.textMuted,
              }}
            >
              Emergency contacts
            </Text>
          </View>

          <View
            className="w-px"
            style={{
              backgroundColor: COLORS.divider,
            }}
          />

          <View className="flex-1 pl-5">
            <Text
              className="text-[13px] font-semibold"
              style={{
                color: isBlocked ? COLORS.danger : COLORS.success,
              }}
            >
              {isBlocked ? "Restricted" : "Active"}
            </Text>

            <Text
              className="mt-1 text-[11px]"
              style={{
                color: COLORS.textMuted,
              }}
            >
              Status
            </Text>
          </View>
        </View>

        {/* ================================================================ */}
        {/* Loading                                                           */}
        {/* ================================================================ */}

        {loadingProfile ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color={COLORS.primary} />

            <Text
              className="mt-3 text-[12px]"
              style={{
                color: COLORS.textSecondary,
              }}
            >
              Loading profile...
            </Text>
          </View>
        ) : (
          <>
            {/* ============================================================ */}
            {/* Error                                                         */}
            {/* ============================================================ */}

            {!!profileError && (
              <View
                className="mt-5 flex-row items-center rounded-xl border p-3.5"
                style={{
                  backgroundColor: COLORS.dangerSoft,
                  borderColor: COLORS.dangerBorder,
                }}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={COLORS.danger}
                />

                <Text
                  className="ml-2 flex-1 text-[12px] leading-5"
                  style={{
                    color: COLORS.danger,
                  }}
                >
                  {profileError}
                </Text>
              </View>
            )}

            {/* ============================================================ */}
            {/* Medical information                                           */}
            {/* ============================================================ */}

            <View className="mt-7">
              <SectionHeader title="Medical information" />

              <View
                className="rounded-xl border px-4"
                style={{
                  backgroundColor: COLORS.surface,
                  borderColor: COLORS.border,
                }}
              >
                <InfoRow
                  label="Blood group"
                  value={profile?.medicalRecord?.bloodGroup || "Not provided"}
                />

                <InfoRow
                  label="Allergies"
                  value={
                    profile?.medicalRecord?.allergies?.join(", ") || "None"
                  }
                />

                <InfoRow
                  label="Medications"
                  value={
                    profile?.medicalRecord?.medications?.join(", ") || "None"
                  }
                />

                <InfoRow
                  label="Conditions"
                  value={profile?.medicalRecord?.diseases?.join(", ") || "None"}
                  last
                />

                {!!profile?.medicalRecord?.notes && (
                  <View
                    className="border-t py-3.5"
                    style={{
                      borderColor: COLORS.divider,
                    }}
                  >
                    <Text
                      className="text-[11px] font-semibold uppercase tracking-[0.8px]"
                      style={{
                        color: COLORS.textMuted,
                      }}
                    >
                      Notes
                    </Text>

                    <Text
                      className="mt-1.5 text-[13px] leading-5"
                      style={{
                        color: COLORS.text,
                      }}
                    >
                      {profile.medicalRecord.notes}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* ============================================================ */}
            {/* SOS message                                                   */}
            {/* ============================================================ */}

            {!!profile?.sosMessage && (
              <View className="mt-7">
                <SectionHeader title="Emergency message" />

                <View
                  className="rounded-xl border p-4"
                  style={{
                    backgroundColor: COLORS.dangerSoft,
                    borderColor: COLORS.dangerBorder,
                  }}
                >
                  <View className="flex-row items-start">
                    <Ionicons
                      name="warning-outline"
                      size={18}
                      color={COLORS.danger}
                    />

                    <Text
                      className="ml-3 flex-1 text-[13px] leading-5"
                      style={{
                        color: COLORS.text,
                      }}
                    >
                      {profile.sosMessage}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* ============================================================ */}
            {/* Emergency contacts                                             */}
            {/* ============================================================ */}

            {contacts.length > 0 && (
              <View className="mt-7">
                <SectionHeader
                  title="Emergency contacts"
                  action="Edit"
                  onAction={() => router.push("/profile/create")}
                />

                <View
                  className="overflow-hidden rounded-xl border"
                  style={{
                    backgroundColor: COLORS.surface,
                    borderColor: COLORS.border,
                  }}
                >
                  {contacts.map((contact, index) => (
                    <View
                      key={`${contact.phoneNumber}-${index}`}
                      className={`flex-row items-center px-4 py-3.5 ${
                        index !== contacts.length - 1
                          ? "border-b border-[#F1EAE5]"
                          : ""
                      }`}
                    >
                      <View
                        className="h-10 w-10 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: COLORS.primarySoft,
                        }}
                      >
                        <Text
                          className="text-[14px] font-bold"
                          style={{
                            color: COLORS.primaryDark,
                          }}
                        >
                          {contact.name?.charAt(0)?.toUpperCase() || "?"}
                        </Text>
                      </View>

                      <View className="ml-3 flex-1">
                        <Text
                          className="text-[14px] font-semibold"
                          style={{
                            color: COLORS.text,
                          }}
                        >
                          {contact.name}
                        </Text>

                        <Text
                          className="mt-0.5 text-[12px]"
                          style={{
                            color: COLORS.textSecondary,
                          }}
                        >
                          {contact.phoneNumber}
                        </Text>
                      </View>

                      {contact.relation && (
                        <Text
                          className="text-[11px]"
                          style={{
                            color: COLORS.textMuted,
                          }}
                        >
                          {contact.relation}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ============================================================ */}
            {/* Safety settings                                                */}
            {/* ============================================================ */}

            <View className="mt-7">
              <SectionHeader title="Safety settings" />

              <View
                className="overflow-hidden rounded-xl border"
                style={{
                  backgroundColor: COLORS.surface,
                  borderColor: COLORS.border,
                }}
              >
                {/* Location */}

                <View className="flex-row items-center px-4 py-4">
                  <View className="flex-1">
                    <Text
                      className="text-[14px] font-semibold"
                      style={{
                        color: COLORS.text,
                      }}
                    >
                      Location sharing
                    </Text>

                    <Text
                      className="mt-1 text-[11px]"
                      style={{
                        color: COLORS.textSecondary,
                      }}
                    >
                      {isTracking
                        ? lastUpdateTime
                          ? `Updated ${lastUpdateTime.toLocaleTimeString()}`
                          : "Updating every 30 seconds"
                        : "Location updates are off"}
                    </Text>

                    {trackingError && (
                      <Text
                        className="mt-1 text-[11px]"
                        style={{
                          color: COLORS.danger,
                        }}
                      >
                        {trackingError}
                      </Text>
                    )}
                  </View>

                  <Pressable
                    onPress={toggleTracking}
                    className="h-7 w-[48px] justify-center rounded-full p-0.5"
                    style={{
                      backgroundColor: trackingEnabled
                        ? COLORS.primary
                        : "#D8CEC7",
                    }}
                  >
                    <View
                      className={`h-6 w-6 rounded-full bg-white ${
                        trackingEnabled ? "self-end" : "self-start"
                      }`}
                    />
                  </Pressable>
                </View>

                {/* Account status */}

                <View className="border-t border-[#F1EAE5] px-4 py-4">
                  <View className="flex-row items-center">
                    <View
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: isBlocked
                          ? COLORS.danger
                          : COLORS.success,
                      }}
                    />

                    <Text
                      className="ml-2 text-[14px] font-semibold"
                      style={{
                        color: COLORS.text,
                      }}
                    >
                      Account status
                    </Text>

                    <Text
                      className="ml-auto text-[12px] font-medium"
                      style={{
                        color: isBlocked ? COLORS.danger : COLORS.success,
                      }}
                    >
                      {isBlocked ? "Restricted" : "Active"}
                    </Text>
                  </View>

                  <Text
                    className="mt-1.5 pl-4 text-[11px]"
                    style={{
                      color: COLORS.textSecondary,
                    }}
                  >
                    Fraud flags: {profile?.accountStatus?.fraudFlagCount ?? 0}
                  </Text>

                  {profile?.accountStatus?.permanentBlockReason && (
                    <Text
                      className="mt-1 pl-4 text-[11px]"
                      style={{
                        color: COLORS.danger,
                      }}
                    >
                      {profile.accountStatus.permanentBlockReason}
                    </Text>
                  )}
                </View>

                {/* Points */}

                <View className="border-t border-[#F1EAE5] flex-row items-center px-4 py-4">
                  <View
                    className="h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: COLORS.warningSoft,
                    }}
                  >
                    <Ionicons
                      name="star-outline"
                      size={16}
                      color={COLORS.warning}
                    />
                  </View>

                  <View className="ml-3 flex-1">
                    <Text
                      className="text-[14px] font-semibold"
                      style={{
                        color: COLORS.text,
                      }}
                    >
                      SafeSphere points
                    </Text>

                    <Text
                      className="mt-0.5 text-[11px]"
                      style={{
                        color: COLORS.textSecondary,
                      }}
                    >
                      Earned through participation
                    </Text>
                  </View>

                  <Text
                    className="text-[18px] font-bold"
                    style={{
                      color: COLORS.warning,
                    }}
                  >
                    {points}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* ================================================================ */}
        {/* Actions                                                           */}
        {/* ================================================================ */}

        <View className="mt-8">
          <Pressable
            onPress={() => router.push("/profile/create")}
            className="h-[52px] flex-row items-center justify-center rounded-xl"
            style={{
              backgroundColor: COLORS.primary,
            }}
          >
            <Ionicons name="create-outline" size={18} color="#FFFFFF" />

            <Text className="ml-2 text-[14px] font-bold text-white">
              Update profile
            </Text>
          </Pressable>

          {userDetails?.role !== "volunteer" && (
            <Pressable
              onPress={() => router.push("/profile/volunteer-apply")}
              className="mt-3 h-[50px] flex-row items-center justify-center rounded-xl border"
              style={{
                borderColor: COLORS.primaryBorder,
                backgroundColor: COLORS.primarySoft,
              }}
            >
              <Ionicons
                name="people-outline"
                size={18}
                color={COLORS.primaryDark}
              />

              <Text
                className="ml-2 text-[14px] font-semibold"
                style={{
                  color: COLORS.primaryDark,
                }}
              >
                Apply as volunteer
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={async () => {
              await logout();
              router.replace("/auth/login");
            }}
            className="mt-4 h-[48px] items-center justify-center"
          >
            <Text
              className="text-[13px] font-semibold"
              style={{
                color: COLORS.danger,
              }}
            >
              Sign out
            </Text>
          </Pressable>
        </View>

        {/* Small footer */}

        <View className="items-center pt-4">
          <Text
            className="text-[10px]"
            style={{
              color: COLORS.textMuted,
            }}
          >
            SafeSphere
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
