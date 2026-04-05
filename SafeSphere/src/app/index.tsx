import React, { useRef, useState, useEffect, useContext } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  FlatList,
  StatusBar,
  Easing,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AuthContext } from "../context/authContext";
import { api } from "../lib/api";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Animated Pulse Ring ─────────────────────────────────────────
function PulseRing({ size, delay, color = "#E53935" }: { size: number; delay: number; color?: string }) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.1,
            duration: 2400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.6,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 2200,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 0, useNativeDriver: true }),
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
        borderWidth: 1.5,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ─── Floating Particle ───────────────────────────────────────────
function FloatingParticle({ x, y, size, delay, color }: { x: number; y: number; size: number; delay: number; color: string }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0.7, duration: 600, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -18, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateY }],
      }}
    />
  );
}

// ─── Shimmer Badge ───────────────────────────────────────────────
function ShimmerBadge({ label, icon, color }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1, 0.7] });

  return (
    <Animated.View
      style={{
        opacity,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: `${color}18`,
        borderColor: `${color}40`,
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 7,
        gap: 6,
      }}
    >
      <Ionicons name={icon} size={12} color={color} />
      <Text style={{ fontSize: 11, fontWeight: "600", color, letterSpacing: 0.3 }}>{label}</Text>
    </Animated.View>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────
function StatCard({ num, label, color, icon }: { num: string; label: string; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity,
        transform: [{ scale }],
        backgroundColor: "#FFFFFF",
        borderRadius: 20,
        padding: 14,
        alignItems: "center",
        shadowColor: color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 4,
        borderWidth: 1,
        borderColor: `${color}20`,
      }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: `${color}15`, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={{ fontSize: 22, fontWeight: "800", color, letterSpacing: -0.5 }}>{num}</Text>
      <Text style={{ fontSize: 9.5, color: "#94A3B8", marginTop: 2, textAlign: "center", fontWeight: "500", letterSpacing: 0.2 }}>{label}</Text>
    </Animated.View>
  );
}

// ─── Feature Row ─────────────────────────────────────────────────
function FeatureRow({
  icon,
  title,
  sub,
  color,
  delay,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  color: string;
  delay: number;
}) {
  const translateX = useRef(new Animated.Value(-30)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, [delay, opacity, translateX]);

  return (
    <Animated.View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: "#F1F5F9",
        opacity,
        transform: [{ translateX }],
      }}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          backgroundColor: `${color}12`,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: `${color}25`,
        }}
      >
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", letterSpacing: -0.2 }}>{title}</Text>
        <Text style={{ fontSize: 11.5, color: "#64748B", marginTop: 2, lineHeight: 16 }}>{sub}</Text>
      </View>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${color}10`, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="chevron-forward" size={14} color={color} />
      </View>
    </Animated.View>
  );
}

// ─── Alert Banner ────────────────────────────────────────────────
function AlertBanner() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.02, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        transform: [{ scale: pulse }],
        backgroundColor: "#FFF1F2",
        borderWidth: 1,
        borderColor: "#FECDD3",
        borderRadius: 18,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 20,
      }}
    >
      <View style={{ width: 40, height: 40, backgroundColor: "#E53935", borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="warning" size={18} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#9F1239", letterSpacing: 0.1 }}>Emergency Alert · Active</Text>
        <Text style={{ fontSize: 10.5, color: "#BE123C", marginTop: 2 }}>Geo-targeted community response activated</Text>
      </View>
      <View style={{ backgroundColor: "#E53935", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
        <Text style={{ fontSize: 9, color: "#fff", fontWeight: "700" }}>LIVE</Text>
      </View>
    </Animated.View>
  );
}

// ─── Map Pin ─────────────────────────────────────────────────────
function MapPin({ label, color, style }: { label: string; color: string; style: object }) {
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -5, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [bounce]);

  return (
    <Animated.View style={[{ position: "absolute", alignItems: "center" }, style, { transform: [{ translateY: bounce }] }]}>
      <View style={{ backgroundColor: color, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, shadowColor: color, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4 }}>
        <Text style={{ fontSize: 9, color: "#fff", fontWeight: "700", letterSpacing: 0.3 }}>{label}</Text>
      </View>
      <View style={{ width: 2, height: 8, backgroundColor: color }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, borderWidth: 2, borderColor: "#FFFFFF" }} />
    </Animated.View>
  );
}

// ─── Connection Line (SVG-like with View) ──────────────────────
// ─── SOS Button ──────────────────────────────────────────────────
function SOSButton() {
  const innerScale = useRef(new Animated.Value(1)).current;
  const pressed = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(pressed, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      Animated.spring(pressed, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(innerScale, { toValue: 0.95, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(innerScale, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [innerScale]);

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={1}>
      <Animated.View style={{ transform: [{ scale: pressed }], alignItems: "center", justifyContent: "center" }}>
        <PulseRing size={100} delay={0} />
        <PulseRing size={148} delay={700} />
        <PulseRing size={196} delay={1400} />

        {/* Outer ring */}
        <View style={{
          width: 90,
          height: 90,
          borderRadius: 45,
          backgroundColor: "#FEE2E2",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#E53935",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 20,
          elevation: 12,
        }}>
          <Animated.View style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: "#E53935",
            alignItems: "center",
            justifyContent: "center",
            transform: [{ scale: innerScale }],
          }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: 3 }}>SOS</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── SCREEN 1 — Hero ─────────────────────────────────────────────
function Screen1() {
  const titleY = useRef(new Animated.Value(30)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const bodyY = useRef(new Animated.Value(20)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const chipsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(180, [
      Animated.parallel([
        Animated.spring(titleY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(bodyY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.timing(chipsOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [bodyOpacity, bodyY, chipsOpacity, titleOpacity, titleY]);

  const particles = [
    { x: 20, y: 60, size: 5, delay: 0, color: "#FECACA" },
    { x: SCREEN_WIDTH - 40, y: 80, size: 7, delay: 400, color: "#BFDBFE" },
    { x: 60, y: 160, size: 4, delay: 800, color: "#E53935" },
    { x: SCREEN_WIDTH - 70, y: 200, size: 6, delay: 200, color: "#1D4ED8" },
    { x: 110, y: 40, size: 3, delay: 600, color: "#FCA5A5" },
    { x: SCREEN_WIDTH - 100, y: 140, size: 5, delay: 1000, color: "#93C5FD" },
  ];

  return (
    <ScrollView
      style={{ width: SCREEN_WIDTH }}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={{ paddingHorizontal: 24, paddingTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 38, height: 38, backgroundColor: "#1D4ED8", borderRadius: 12, alignItems: "center", justifyContent: "center", shadowColor: "#1D4ED8", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }}>
            <Ionicons name="shield-checkmark" size={19} color="#FFFFFF" />
          </View>
          <Text style={{ fontSize: 20, fontWeight: "900", color: "#0F172A", letterSpacing: -0.5 }}>
            Safe<Text style={{ color: "#1D4ED8" }}>Sphere</Text>
          </Text>
        </View>
          <View style={{ backgroundColor: "#EFF6FF", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="shield-checkmark-outline" size={12} color="#1D4ED8" />
            <Text style={{ fontSize: 10.5, fontWeight: "600", color: "#1D4ED8" }}>Protected</Text>
          </View>
      </View>

      {/* Particles */}
      <View style={{ height: 240, position: "relative", alignItems: "center", justifyContent: "center" }}>
        {particles.map((p, i) => <FloatingParticle key={i} {...p} />)}
        <SOSButton />
      </View>

      {/* Text block */}
      <View style={{ paddingHorizontal: 24 }}>
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }] }}>
          <Text style={{ fontSize: 32, fontWeight: "900", color: "#0F172A", lineHeight: 38, letterSpacing: -0.8, marginBottom: 10 }}>
            Emergency Help,{"\n"}
            <Text style={{ color: "#1D4ED8" }}>Instantly Activated</Text>
          </Text>
        </Animated.View>

        <Animated.View style={{ opacity: bodyOpacity, transform: [{ translateY: bodyY }] }}>
          <Text style={{ fontSize: 14, color: "#64748B", lineHeight: 22, marginBottom: 22, fontWeight: "400" }}>
            One tap connects you to nearby responders, volunteers, and authorities — in the critical moments that matter most.
          </Text>
        </Animated.View>

        {/* Chips */}
        <Animated.View style={{ opacity: chipsOpacity, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ShimmerBadge label="One-tap SOS" icon="radio-button-on" color="#E53935" />
          <ShimmerBadge label="AI Dispatch" icon="hardware-chip-outline" color="#1D4ED8" />
          <ShimmerBadge label="Live Tracking" icon="location" color="#16A34A" />
          <ShimmerBadge label="Voice Panic" icon="mic" color="#7C3AED" />
        </Animated.View>
      </View>
    </ScrollView>
  );
}

// ─── SCREEN 2 — Map / Responders ─────────────────────────────────
function Screen2() {
  const cardY = useRef(new Animated.Value(24)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const statsOpacity = useRef(new Animated.Value(0)).current;
  const textY = useRef(new Animated.Value(20)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const mapHeight = SCREEN_HEIGHT * 0.44;

  useEffect(() => {
    Animated.stagger(160, [
      Animated.parallel([
        Animated.spring(cardY, { toValue: 0, friction: 7, tension: 70, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(textY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(textOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
      Animated.timing(statsOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();
  }, [cardOpacity, cardY, statsOpacity, textOpacity, textY]);

  // Pin positions scaled to map width
  const pw = SCREEN_WIDTH;
  const incidentX = pw * 0.45;
  const incidentY = mapHeight * 0.16;

  return (
    <View style={{ width: SCREEN_WIDTH, flex: 1 }}>
      {/* ── MAP ── fills 44% of screen height */}
      <View style={{ height: mapHeight, backgroundColor: "#EEF2FF", overflow: "hidden", position: "relative" }}>

        {/* Grid */}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: i * (mapHeight / 5), height: 1, backgroundColor: "#C7D2FE35" }} />
        ))}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: i * (pw / 5), width: 1, backgroundColor: "#C7D2FE35" }} />
        ))}

        {/* Outer radius ring */}
        <View style={{
          position: "absolute",
          left: incidentX - 80,
          top: incidentY - 50,
          width: 160,
          height: 160,
          borderRadius: 80,
          borderWidth: 1.5,
          borderColor: "#E5393528",
          backgroundColor: "#E5393506",
        }} />
        {/* Inner radius ring */}
        <View style={{
          position: "absolute",
          left: incidentX - 44,
          top: incidentY - 14,
          width: 88,
          height: 88,
          borderRadius: 44,
          borderWidth: 1,
          borderColor: "#E5393540",
          backgroundColor: "transparent",
        }} />

        {/* Dashed connection lines */}
        <View style={{ position: "absolute", left: pw * 0.18, top: mapHeight * 0.36, width: pw * 0.28, height: 1.5, backgroundColor: "#1D4ED840", transform: [{ rotate: "-28deg" }] }} />
        <View style={{ position: "absolute", left: incidentX + 10, top: incidentY + 20, width: pw * 0.25, height: 1.5, backgroundColor: "#16A34A40", transform: [{ rotate: "18deg" }] }} />
        <View style={{ position: "absolute", left: incidentX - 10, top: incidentY + 35, width: pw * 0.2, height: 1.5, backgroundColor: "#7C3AED40", transform: [{ rotate: "42deg" }] }} />

        {/* Map Pins */}
        <MapPin label="Incident" color="#E53935" style={{ top: incidentY, left: incidentX - 30 }} />
        <MapPin label="Police"   color="#1D4ED8" style={{ top: mapHeight * 0.38, left: pw * 0.09 }} />
        <MapPin label="Medic"    color="#16A34A" style={{ top: mapHeight * 0.22, left: pw * 0.68 }} />
        <MapPin label="Volunteer" color="#7C3AED" style={{ top: mapHeight * 0.52, left: pw * 0.55 }} />

        {/* Responder card — floats at bottom of map */}
        <Animated.View
          style={{
            position: "absolute",
            bottom: 14,
            left: 14,
            right: 14,
            backgroundColor: "#FFFFFF",
            borderRadius: 20,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 13,
            shadowColor: "#1D4ED8",
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.13,
            shadowRadius: 18,
            elevation: 10,
            opacity: cardOpacity,
            transform: [{ translateY: cardY }],
          }}
        >
          <View style={{
            width: 46, height: 46, borderRadius: 14,
            backgroundColor: "#DCFCE7",
            alignItems: "center", justifyContent: "center",
            borderWidth: 2, borderColor: "#86EFAC",
          }}>
            <Ionicons name="medkit-outline" size={20} color="#15803D" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", letterSpacing: -0.2 }}>Nearest Medical Responder</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#16A34A" }} />
              <Text style={{ fontSize: 11, color: "#64748B" }}>Verified Volunteer · En route</Text>
            </View>
          </View>
          <View style={{ alignItems: "center", gap: 4 }}>
            <View style={{ backgroundColor: "#DCFCE7", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ fontSize: 13, fontWeight: "800", color: "#16A34A" }}>ETA</Text>
            </View>
            <Ionicons name="navigate" size={12} color="#16A34A" />
          </View>
        </Animated.View>
      </View>

      {/* ── CONTENT ── fills remaining space */}
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 12, justifyContent: "space-between" }}>

        <Animated.View style={{ opacity: textOpacity, transform: [{ translateY: textY }] }}>
          <Text style={{ fontSize: 30, fontWeight: "900", color: "#0F172A", lineHeight: 36, letterSpacing: -0.8, marginBottom: 8 }}>
            Coordinated{"\n"}
            <Text style={{ color: "#1D4ED8" }}>Real-Time Response</Text>
          </Text>
          <Text style={{ fontSize: 13.5, color: "#64748B", lineHeight: 21, fontWeight: "400" }}>
            Our AI instantly notifies the nearest verified responders and emergency services — coordinating help before it is too late.
          </Text>
        </Animated.View>

        <Animated.View style={{ flexDirection: "row", gap: 10, opacity: statsOpacity }}>
          <StatCard num="Fast" label="Response Time" color="#1D4ED8" icon="flash" />
          <StatCard num="Wide" label="Coverage Area" color="#16A34A" icon="people" />
          <StatCard num="24/7" label="Monitoring" color="#E53935" icon="eye" />
        </Animated.View>

      </View>
    </View>
  );
}

// ─── SCREEN 3 — Alert + Features ─────────────────────────────────
function Screen3() {
  return (
    <View style={{ width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 20 }}>

      {/* Logo */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <View style={{
          width: 38, height: 38, backgroundColor: "#1D4ED8", borderRadius: 12,
          alignItems: "center", justifyContent: "center",
          shadowColor: "#1D4ED8", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
        }}>
          <Ionicons name="shield-checkmark" size={19} color="#FFFFFF" />
        </View>
        <Text style={{ fontSize: 20, fontWeight: "900", color: "#0F172A", letterSpacing: -0.5 }}>
          Safe<Text style={{ color: "#1D4ED8" }}>Sphere</Text>
        </Text>
      </View>

      {/* Alert Banner */}
      <AlertBanner />

      {/* Section label */}
      <Text style={{ fontSize: 12, fontWeight: "700", color: "#94A3B8", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
        Core Capabilities
      </Text>

      {/* Feature rows — evenly spaced to fill screen */}
      <View style={{ flex: 1, justifyContent: "space-evenly" }}>
        <FeatureRow
          icon="hardware-chip-outline"
          title="AI Step-by-Step Guidance"
          sub="Real-time help for victims until responders arrive"
          color="#1D4ED8"
          delay={80}
        />
        <FeatureRow
          icon="videocam-outline"
          title="Live Audio/Video Streaming"
          sub="Real-time feed shared from the incident location"
          color="#E53935"
          delay={180}
        />
        <FeatureRow
          icon="people-outline"
          title="Crowdsourced Recovery"
          sub="Community-powered alerts and search coordination"
          color="#7C3AED"
          delay={280}
        />
        <FeatureRow
          icon="shield-outline"
          title="Encrypted Communications"
          sub="End-to-end secured data at all times"
          color="#16A34A"
          delay={380}
        />
      </View>
    </View>
  );
}

// ─── SCREEN 4 — CTA / Get Started ────────────────────────────────
function Screen4({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const loginScale = useRef(new Animated.Value(1)).current;
  const registerScale = useRef(new Animated.Value(1)).current;
  const contentY = useRef(new Animated.Value(30)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const badgesOpacity = useRef(new Animated.Value(0)).current;
  const btnsY = useRef(new Animated.Value(24)).current;
  const btnsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(160, [
      Animated.parallel([
        Animated.spring(contentY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(contentOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
      Animated.timing(badgesOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.parallel([
        Animated.spring(btnsY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.timing(btnsOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    ]).start();
  }, [badgesOpacity, btnsOpacity, btnsY, contentOpacity, contentY]);

  const pressIn = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 0.96, friction: 8, useNativeDriver: true }).start();
  const pressOut = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 1, friction: 6, useNativeDriver: true }).start();

  // Trust badges
  const badges = [
    { icon: "flash-outline" as const,          label: "Instant Response",    color: "#1D4ED8" },
    { icon: "globe-outline" as const,           label: "City-Wide Coverage",  color: "#7C3AED" },
    { icon: "lock-closed-outline" as const,     label: "Secure & Private",    color: "#16A34A" },
    { icon: "people-circle-outline" as const,   label: "Community Powered",   color: "#E53935" },
  ];

  return (
    <View style={{ width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28, justifyContent: "space-between" }}>

      {/* Top: heading + body */}
      <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentY }] }}>
        {/* Eyebrow */}
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8,
          backgroundColor: "#EFF6FF", borderRadius: 20,
          paddingHorizontal: 14, paddingVertical: 7,
          alignSelf: "flex-start", marginBottom: 20,
          borderWidth: 1, borderColor: "#BFDBFE",
        }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#1D4ED8" }} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#1D4ED8", letterSpacing: 0.4 }}>Ready to protect you</Text>
        </View>

        <Text style={{ fontSize: 34, fontWeight: "900", color: "#0F172A", letterSpacing: -1, lineHeight: 40, marginBottom: 14 }}>
          Built for the{"\n"}
          <Text style={{ color: "#1D4ED8" }}>Critical{"\n"}Minutes</Text>
        </Text>

        <Text style={{ fontSize: 14, color: "#64748B", lineHeight: 22, fontWeight: "400" }}>
          A scalable smart city solution designed to reduce response time, improve coordination, and save lives — city-wide and beyond.
        </Text>
      </Animated.View>

      {/* Middle: trust badge grid */}
      <Animated.View style={{ opacity: badgesOpacity }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {badges.map((b, i) => (
            <View
              key={i}
              style={{
                flexDirection: "row", alignItems: "center", gap: 7,
                backgroundColor: `${b.color}0D`,
                borderWidth: 1, borderColor: `${b.color}25`,
                borderRadius: 14,
                paddingHorizontal: 13, paddingVertical: 9,
                width: (SCREEN_WIDTH - 48 - 10) / 2,
              }}
            >
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${b.color}15`, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={b.icon} size={14} color={b.color} />
              </View>
              <Text style={{ fontSize: 11.5, fontWeight: "600", color: "#334155", flex: 1 }}>{b.label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Bottom: CTA buttons */}
      <Animated.View style={{ opacity: btnsOpacity, transform: [{ translateY: btnsY }], gap: 12 }}>
        {/* Login */}
        <Animated.View style={{ transform: [{ scale: loginScale }] }}>
          <TouchableOpacity
            onPressIn={() => pressIn(loginScale)}
            onPressOut={() => pressOut(loginScale)}
            onPress={onLogin}
            activeOpacity={1}
            style={{
              backgroundColor: "#1D4ED8",
              borderRadius: 20,
              paddingVertical: 18,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 9,
              shadowColor: "#1D4ED8",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.38,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            <Ionicons name="log-in-outline" size={19} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 0.2 }}>Login</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Register */}
        <Animated.View style={{ transform: [{ scale: registerScale }] }}>
          <TouchableOpacity
            onPressIn={() => pressIn(registerScale)}
            onPressOut={() => pressOut(registerScale)}
            onPress={onRegister}
            activeOpacity={1}
            style={{
              borderWidth: 1.5,
              borderColor: "#1D4ED8",
              borderRadius: 20,
              paddingVertical: 17,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 9,
              backgroundColor: "#EFF6FF",
            }}
          >
            <Ionicons name="person-add-outline" size={19} color="#1D4ED8" />
            <Text style={{ color: "#1D4ED8", fontSize: 16, fontWeight: "800", letterSpacing: 0.2 }}>Create Account</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Fine print */}
        <Text style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", marginTop: 2 }}>
          By continuing you agree to our Terms & Privacy Policy
        </Text>
      </Animated.View>
    </View>
  );
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────
export default function SafeSphereOnboarding() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const redirectedRef = useRef(false);
  const { userDetails, isAuthenticated } = useContext(AuthContext);

  useEffect(() => {
    const redirectAuthenticatedUser = async () => {
      if (redirectedRef.current || !isAuthenticated || !userDetails?.phoneNumber) return;
      redirectedRef.current = true;

      if (!userDetails.isVerified) {
        try {
          await api.post("/public-user/send-otp", { phoneNumber: userDetails.phoneNumber });
        } catch (error) {
          console.error("Failed to trigger OTP for verified flow:", error);
        }
        router.replace({ pathname: "/auth/verify-otp", params: { phoneNumber: userDetails.phoneNumber, mode: "login" } });
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
    { key: "s3", component: <Screen3 /> },
    {
      key: "s4",
      component: (
        <Screen4
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
    <View style={{ flex: 1, backgroundColor: "#FFFFFF", paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <FlatList
        ref={flatRef}
        data={screens}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_WIDTH, flex: 1 }}>{item.component}</View>
        )}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      />

      {/* Bottom nav — hidden on last screen (CTA takes over) */}
      {!isLast && (
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderTopWidth: 1,
          borderTopColor: "#F1F5F9",
          backgroundColor: "#FFFFFF",
        }}>
          {/* Skip to last */}
          <TouchableOpacity onPress={() => goTo(screens.length - 1)}>
            <Text style={{ fontSize: 13.5, color: "#94A3B8", fontWeight: "500" }}>Skip</Text>
          </TouchableOpacity>

          {/* Dot indicators */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {screens.map((_, i) => (
              <View
                key={i}
                style={{
                  height: 7,
                  width: current === i ? 24 : 7,
                  borderRadius: 4,
                  backgroundColor: current === i ? "#1D4ED8" : "#CBD5E1",
                }}
              />
            ))}
          </View>

          {/* Next */}
          <TouchableOpacity
            onPress={() => goTo(current + 1)}
            activeOpacity={0.85}
            style={{
              width: 50,
              height: 50,
              borderRadius: 16,
              backgroundColor: "#1D4ED8",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#1D4ED8",
              shadowOffset: { width: 0, height: 5 },
              shadowOpacity: 0.35,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}