import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  FlatList,
  StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useContext } from "react";
import { AuthContext } from "../context/authContext";
import { api } from "../lib/api";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Animated Pulse Ring ─────────────────────────────────────────
function PulseRing({ size, delay }: { size: number; delay: number }) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.75,
              duration: 100,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 1900,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, opacity, scale]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: "#E53935",
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ─── Feature Chip ────────────────────────────────────────────────
function Chip({
  label,
  dotClass,
  bgClass,
  textClass,
}: {
  label: string;
  dotClass: string;
  bgClass: string;
  textClass: string;
}) {
  return (
    <View className={`flex-row items-center gap-x-1.5 px-3 py-1.5 rounded-full ${bgClass}`}>
      <View className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <Text className={`text-xs font-medium ${textClass}`}>{label}</Text>
    </View>
  );
}

// ─── Stat Box ────────────────────────────────────────────────────
function StatBox({
  num,
  label,
  numClass,
}: {
  num: string;
  label: string;
  numClass: string;
}) {
  return (
    <View className="flex-1 bg-gray-100 rounded-2xl p-3 items-center">
      <Text className={`text-xl font-extrabold ${numClass}`}>{num}</Text>
      <Text className="text-[10px] text-gray-500 mt-0.5 text-center">{label}</Text>
    </View>
  );
}

// ─── Feature Item ────────────────────────────────────────────────
function FeatItem({
  icon,
  title,
  sub,
  iconBgClass,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  iconBgClass: string;
}) {
  return (
    <View className="flex-row items-center gap-x-3 py-3 border-b border-gray-100">
      <View className={`w-10 h-10 rounded-xl items-center justify-center ${iconBgClass}`}>
        <Ionicons name={icon} size={18} color="#1D4ED8" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900">{title}</Text>
        <Text className="text-[11px] text-gray-500 mt-0.5">{sub}</Text>
      </View>
    </View>
  );
}

// ─── Map Pin (uses inline style — positioned absolutely) ─────────
function MapPin({
  label,
  color,
  style,
}: {
  label: string;
  color: string;
  style: object;
}) {
  return (
    <View style={[{ position: "absolute", alignItems: "center" }, style]}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: color,
          borderWidth: 2,
          borderColor: "#FFFFFF",
        }}
      />
      <View
        style={{
          backgroundColor: color,
          borderRadius: 4,
          paddingHorizontal: 5,
          paddingVertical: 2,
          marginTop: 2,
        }}
      >
        <Text style={{ fontSize: 9, color: "#fff", fontWeight: "600" }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// ─── SCREEN 1 — Hero / SOS ───────────────────────────────────────
function Screen1() {
  return (
    <ScrollView
      style={{ width: SCREEN_WIDTH }}
      contentContainerStyle={{ paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="px-6 pt-2">
        {/* Logo */}
        <View className="flex-row items-center gap-x-2 mb-5">
          <View className="w-9 h-9 bg-blue-600 rounded-xl items-center justify-center">
            <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
          </View>
          <Text className="text-xl font-extrabold text-gray-900 tracking-tight">
            Safe<Text className="text-blue-600">Sphere</Text>
          </Text>
        </View>

        {/* Pulse + SOS button */}
        <View className="items-center justify-center h-44 mb-3">
          <PulseRing size={90} delay={0} />
          <PulseRing size={130} delay={600} />
          <PulseRing size={170} delay={1200} />
          <View className="w-20 h-20 rounded-full bg-red-600 items-center justify-center z-10">
            <Text className="text-white text-base font-extrabold tracking-widest">
              SOS
            </Text>
          </View>
        </View>

        {/* Heading */}
        <Text className="text-3xl font-extrabold text-gray-900 leading-tight mb-2">
          Emergency Help,{"\n"}
          <Text className="text-blue-600">Instantly Activated</Text>
        </Text>

        {/* Body copy */}
        <Text className="text-sm text-gray-500 leading-relaxed mb-5">
          One tap connects you to nearby responders, volunteers, and authorities
          — in the critical moments that matter most.
        </Text>

        {/* Feature chips */}
        <View className="flex-row flex-wrap gap-2">
          <Chip
            label="One-tap SOS"
            dotClass="bg-red-600"
            bgClass="bg-red-50"
            textClass="text-red-800"
          />
          <Chip
            label="AI Dispatch"
            dotClass="bg-blue-600"
            bgClass="bg-blue-50"
            textClass="text-blue-800"
          />
          <Chip
            label="Live Tracking"
            dotClass="bg-green-500"
            bgClass="bg-green-50"
            textClass="text-green-800"
          />
          <Chip
            label="Voice Panic"
            dotClass="bg-blue-600"
            bgClass="bg-blue-50"
            textClass="text-blue-800"
          />
        </View>
      </View>
    </ScrollView>
  );
}

// ─── SCREEN 2 — Map / Responders ─────────────────────────────────
function Screen2() {
  return (
    <ScrollView
      style={{ width: SCREEN_WIDTH }}
      contentContainerStyle={{ paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Map area */}
      <View className="h-52 bg-indigo-50 overflow-hidden">
        <MapPin label="Incident" color="#E53935" style={{ top: 32, left: 120 }} />
        <MapPin label="Police"   color="#1A56DB" style={{ top: 60, left: 48 }} />
        <MapPin label="Medic"    color="#22C55E" style={{ top: 45, left: 210 }} />
        <MapPin label="Volunteer" color="#1A56DB" style={{ top: 90, left: 165 }} />

        {/* Floating responder card */}
        <View className="absolute bottom-2.5 left-2.5 right-2.5 bg-white rounded-2xl p-2.5 flex-row items-center gap-x-2.5 shadow-md">
          <View className="w-9 h-9 rounded-full bg-green-100 items-center justify-center">
            <Text className="text-xs font-bold text-green-700">DR</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-gray-900">
              Dr. Rahul Sharma
            </Text>
            <Text className="text-[10px] text-gray-500 mt-0.5">
              Medical Volunteer · 0.4 km away
            </Text>
          </View>
          <View className="bg-green-100 rounded-full px-2 py-0.5">
            <Text className="text-xs font-semibold text-green-700">2 min</Text>
          </View>
        </View>
      </View>

      <View className="px-6 pt-4">
        {/* Heading */}
        <Text className="text-3xl font-extrabold text-gray-900 leading-tight mb-2">
          Coordinated{"\n"}
          <Text className="text-blue-600">Real-Time Response</Text>
        </Text>

        {/* Body copy */}
        <Text className="text-sm text-gray-500 leading-relaxed mb-5">
          Our AI instantly notifies the nearest verified responders and emergency
          services — coordinating help before it is too late.
        </Text>

        {/* Stat row */}
        <View className="flex-row gap-x-2">
          <StatBox num="3×"   label="faster response" numClass="text-blue-600" />
          <StatBox num="10k+" label="volunteers"       numClass="text-green-500" />
          <StatBox num="24/7" label="monitoring"       numClass="text-red-600" />
        </View>
      </View>
    </ScrollView>
  );
}

// ─── SCREEN 3 — Features / CTA ───────────────────────────────────
function Screen3({
  onLogin,
  onRegister,
}: {
  onLogin: () => void;
  onRegister: () => void;
}) {
  return (
    <ScrollView
      style={{ width: SCREEN_WIDTH }}
      contentContainerStyle={{ paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="px-6 pt-2">
        {/* Logo */}
        <View className="flex-row items-center gap-x-2 mb-4">
          <View className="w-9 h-9 bg-blue-600 rounded-xl items-center justify-center">
            <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
          </View>
          <Text className="text-xl font-extrabold text-gray-900 tracking-tight">
            Safe<Text className="text-blue-600">Sphere</Text>
          </Text>
        </View>

        {/* Missing child alert banner */}
        <View className="bg-red-50 border border-red-200 rounded-2xl p-3 flex-row items-center gap-x-3 mb-4">
          <View className="w-9 h-9 bg-red-600 rounded-xl items-center justify-center">
            <Ionicons name="warning" size={16} color="#FFFFFF" />
          </View>
          <View>
            <Text className="text-xs font-semibold text-red-800">
              Child Missing Alert · Active
            </Text>
            <Text className="text-[10px] text-red-700 mt-0.5">
              Geo-targeted search · 2.1 km radius
            </Text>
          </View>
        </View>

        {/* Feature list */}
        <FeatItem
          icon="hardware-chip-outline"
          iconBgClass="bg-blue-50"
          title="AI Step-by-Step Guidance"
          sub="Help for victims until responders arrive"
        />
        <FeatItem
          icon="videocam-outline"
          iconBgClass="bg-red-50"
          title="Live Audio/Video Streaming"
          sub="Real-time feed from incident location"
        />
        <FeatItem
          icon="people-outline"
          iconBgClass="bg-green-50"
          title="Crowdsourced Child Recovery"
          sub="Community-powered missing person alerts"
        />

        {/* Final heading */}
        <Text className="text-3xl font-extrabold text-gray-900 leading-tight mt-5 mb-2">
          Built for the{"\n"}
          <Text className="text-blue-600">Critical Minutes</Text>
        </Text>
        <Text className="text-sm text-gray-500 leading-relaxed mb-5">
          Scalable smart city solution designed to reduce response time, improve
          coordination, and save lives — city-wide and beyond.
        </Text>

        {/* CTA buttons */}
        <TouchableOpacity
          className="bg-blue-600 rounded-2xl py-4 items-center active:opacity-80"
          onPress={onLogin}
          activeOpacity={0.85}
        >
          <Text className="text-white text-base font-bold tracking-wide">
            Login
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="mt-3 border border-blue-600 rounded-2xl py-4 items-center active:opacity-80"
          onPress={onRegister}
          activeOpacity={0.85}
        >
          <Text className="text-blue-700 text-base font-bold tracking-wide">
            Register
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── ROOT COMPONENT ──────────────────────────────────────────────
export default function SafeSphereOnboarding() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const redirectedRef = useRef(false);
  const { userDetails, isAuthenticated } = useContext(AuthContext);

  useEffect(() => {
    const redirectAuthenticatedUser = async () => {
      if (redirectedRef.current || !isAuthenticated || !userDetails?.phoneNumber) {
        return;
      }

      redirectedRef.current = true;

      if (!userDetails.isVerified) {
        try {
          await api.post("/public-user/send-otp", {
            phoneNumber: userDetails.phoneNumber,
          });
        } catch (error) {
          console.error("Failed to trigger OTP for verified flow:", error);
        }

        router.replace({
          pathname: "/auth/verify-otp",
          params: {
            phoneNumber: userDetails.phoneNumber,
            mode: "login",
          },
        });
        return;
      }

      if (!userDetails.isprofileComplete) {
        router.replace("/profile/create");
        return;
      }

      router.replace("/(tabs)");
    };

    void redirectAuthenticatedUser();
  }, [isAuthenticated, userDetails]);

  const screens = [
    { key: "s1", component: <Screen1 /> },
    { key: "s2", component: <Screen2 /> },
    {
      key: "s3",
      component: (
        <Screen3
          onLogin={() => router.replace("/auth/login")}
          onRegister={() => router.replace("/auth/register")}
        />
      ),
    },
  ];

  const isLast = current === screens.length - 1;

  const goTo = (index: number) => {
    if (index >= screens.length) {
      router.replace("/auth/login");
      return;
    }
    flatRef.current?.scrollToIndex({ index, animated: true });
    setCurrent(index);
  };

  return (
    <View
      className="flex-1 bg-white"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Paged carousel */}
      <FlatList
        ref={flatRef}
        data={screens}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => item.component}
        style={{ flex: 1 }}
      />

      {/* Bottom nav — hidden on last screen (CTA takes over) */}
      {!isLast && (
        <View className="flex-row items-center justify-between px-6 py-4 border-t border-gray-100 bg-white">
          {/* Skip */}
          <TouchableOpacity onPress={() => goTo(screens.length - 1)}>
            <Text className="text-sm text-gray-400 font-medium">Skip</Text>
          </TouchableOpacity>

          {/* Dot indicators */}
          <View className="flex-row items-center gap-x-1.5">
            {screens.map((_, i) => (
              <View
                key={i}
                className={`h-2 rounded-full transition-all ${
                  current === i ? "w-6 bg-blue-600" : "w-2 bg-gray-300"
                }`}
              />
            ))}
          </View>

          {/* Next arrow */}
          <TouchableOpacity
            className="w-12 h-12 rounded-full bg-blue-600 items-center justify-center"
            onPress={() => goTo(current + 1)}
            activeOpacity={0.85}
          >
            <Text className="text-white text-xl leading-none">→</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}