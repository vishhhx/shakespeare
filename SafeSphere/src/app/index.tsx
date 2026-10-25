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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AuthContext } from "../context/authContext";
import { api } from "../lib/api";

const { width: W, height: H } = Dimensions.get("window");

/* -------------------------------------------------------------------------- */
/* Design tokens                                                               */
/* -------------------------------------------------------------------------- */
/*
  Palette — light theme
  - background   #FAFAF9  warm-white base canvas
  - backgroundHi #F2F1EE  hero wash, one step down from white
  - surface      #FFFFFF  panel / card fill
  - surfaceAlt   #F2F1EE  raised card / pressed state
  - line         rgba(15,23,32,0.08)  hairline borders on light
  - lineStrong   rgba(15,23,32,0.16)
  - primary      #FF7A1A  SafeSphere orange — accent only, never a fill field
  - emergency    #E8412C  SOS / alert red, tuned darker to hold contrast on white
  - success      #159960  online / verified state, tuned darker for light bg
  - text         #14181F
  - textDim      #5B6472
  - textFaint    #9198A6
*/

const COLORS = {
  background: "#FAFAF9",
  backgroundHi: "#F2F1EE",
  surface: "#FFFFFF",
  surfaceAlt: "#F2F1EE",
  line: "rgba(15,23,32,0.08)",
  lineStrong: "rgba(15,23,32,0.16)",

  primary: "#FF7A1A",
  primaryDim: "rgba(255,122,26,0.10)",
  primaryLine: "rgba(255,122,26,0.45)",

  emergency: "#E8412C",
  emergencyDim: "rgba(232,65,44,0.09)",
  emergencyLine: "rgba(232,65,44,0.4)",

  success: "#159960",
  successDim: "rgba(21,153,96,0.10)",

  text: "#14181F",
  textDim: "#5B6472",
  textFaint: "#9198A6",
};

/* -------------------------------------------------------------------------- */
/* Small reusable animations                                                   */
/* -------------------------------------------------------------------------- */

function FadeUp({
  children,
  delay = 0,
  dy = 14,
}: {
  children: React.ReactNode;
  delay?: number;
  dy?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(dy)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 9,
          tension: 55,
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function PulsingDot({ color, size = 6 }: { color: string; size?: number }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Emergency control — the signature element                                  */
/* Concentric radar rings expanding outward from a central SOS control, with  */
/* small live-status chips (GPS / signal) orbiting the field.                 */
/* -------------------------------------------------------------------------- */

function RadarSweep({
  delay,
  size,
  color,
}: {
  delay: number;
  size: number;
  color: string;
}) {
  const scale = useRef(new Animated.Value(0.55)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 2400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(scale, {
          toValue: 0.55,
          duration: 1,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [delay, opacity, scale]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

function FieldNode({
  icon,
  label,
  style,
  delay,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  style: object;
  delay: number;
}) {
  return (
    <FadeUp delay={delay} dy={0}>
      <View
        style={[
          {
            position: "absolute",
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(255,255,255,0.92)",
            borderWidth: 1,
            borderColor: COLORS.line,
            borderRadius: 999,
            paddingVertical: 5,
            paddingHorizontal: 9,
          },
          style,
        ]}
      >
        <Ionicons name={icon} size={10} color={COLORS.success} />
        <Text
          style={{
            marginLeft: 5,
            fontSize: 9,
            fontWeight: "700",
            letterSpacing: 0.6,
            color: COLORS.textDim,
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
      </View>
    </FadeUp>
  );
}

function EmergencyControl() {
  const pulse = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0.5)).current;
  const fieldSize = Math.min(W * 0.78, 300);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse, {
            toValue: 1.045,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0.5,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [glow, pulse]);

  return (
    <View
      style={{
        width: fieldSize,
        height: fieldSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Expanding radar sweeps */}
      <RadarSweep delay={0} size={fieldSize} color={COLORS.emergency} />
      <RadarSweep delay={1200} size={fieldSize} color={COLORS.emergency} />

      {/* Static concentric field rings */}
      <View
        style={{
          position: "absolute",
          width: fieldSize * 0.72,
          height: fieldSize * 0.72,
          borderRadius: (fieldSize * 0.72) / 2,
          borderWidth: 1,
          borderColor: COLORS.line,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: fieldSize * 0.5,
          height: fieldSize * 0.5,
          borderRadius: (fieldSize * 0.5) / 2,
          borderWidth: 1,
          borderColor: COLORS.line,
        }}
      />

      {/* Soft layered glow behind the button, built from stacked translucent Views */}
      <View
        style={{
          position: "absolute",
          width: fieldSize * 0.46,
          height: fieldSize * 0.46,
          borderRadius: (fieldSize * 0.46) / 2,
          backgroundColor: COLORS.emergencyDim,
        }}
      />
      <Animated.View
        style={{
          position: "absolute",
          width: fieldSize * 0.36,
          height: fieldSize * 0.36,
          borderRadius: (fieldSize * 0.36) / 2,
          backgroundColor: COLORS.emergencyDim,
          opacity: glow,
        }}
      />

      {/* Central SOS control */}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <View
          style={{
            width: fieldSize * 0.32,
            height: fieldSize * 0.32,
            borderRadius: (fieldSize * 0.32) / 2,
            backgroundColor: COLORS.emergency,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.25)",
          }}
        >
          <Ionicons name="alert" size={22} color="#FFFFFF" />
          <Text
            style={{
              marginTop: 3,
              color: "#FFFFFF",
              fontSize: 16,
              fontWeight: "800",
              letterSpacing: 2,
            }}
          >
            SOS
          </Text>
        </View>
      </Animated.View>

      {/* Live status chips orbiting the field */}
      <FieldNode
        icon="locate"
        label="GPS locked"
        delay={500}
        style={{ top: fieldSize * 0.06, right: fieldSize * 0.0 }}
      />
      <FieldNode
        icon="wifi"
        label="Network live"
        delay={650}
        style={{ bottom: fieldSize * 0.1, left: -fieldSize * 0.02 }}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Status indicator                                                            */
/* -------------------------------------------------------------------------- */

function SystemStatus() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "center",
        backgroundColor: COLORS.surface,
        borderWidth: 1,
        borderColor: COLORS.line,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
      }}
    >
      <PulsingDot color={COLORS.success} />
      <View style={{ marginLeft: 9 }}>
        <Text
          style={{
            fontSize: 10.5,
            fontWeight: "800",
            letterSpacing: 1,
            color: COLORS.success,
            textTransform: "uppercase",
          }}
        >
          System online
        </Text>
        <Text style={{ fontSize: 10.5, color: COLORS.textFaint, marginTop: 1 }}>
          Emergency network ready
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Capability card                                                             */
/* -------------------------------------------------------------------------- */

function CapabilityCard({
  icon,
  title,
  description,
  accent,
  accentDim,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  accent: string;
  accentDim: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: COLORS.surface,
        borderWidth: 1,
        borderColor: COLORS.line,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 13,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          backgroundColor: accentDim,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: accent + "33",
        }}
      >
        <Ionicons name={icon} size={16} color={accent} />
      </View>

      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 12.5, fontWeight: "700", color: COLORS.text }}>
          {title}
        </Text>
        <Text style={{ marginTop: 2, fontSize: 11, color: COLORS.textDim }}>
          {description}
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* SCREEN 1 — Hero                                                             */
/* -------------------------------------------------------------------------- */

function HeroScreen() {
  return (
    <View style={{ width: W, flex: 1, backgroundColor: COLORS.background }}>
      {/* -------------------------------------------------------------- */}
      {/* Visual field                                                   */}
      {/* -------------------------------------------------------------- */}

      <View
        style={{
          height: H * 0.46,
          backgroundColor: COLORS.backgroundHi,
          alignItems: "center",
          justifyContent: "center",
          borderBottomWidth: 1,
          borderBottomColor: COLORS.line,
        }}
      >
        <FadeUp delay={60}>
          <EmergencyControl />
        </FadeUp>

        <View style={{ position: "absolute", bottom: 20 }}>
          <FadeUp delay={420} dy={6}>
            <SystemStatus />
          </FadeUp>
        </View>
      </View>

      {/* -------------------------------------------------------------- */}
      {/* Content                                                        */}
      {/* -------------------------------------------------------------- */}

      <View
        style={{
          flex: 1,
          paddingHorizontal: 26,
          paddingTop: 26,
          paddingBottom: 18,
        }}
      >
        <FadeUp delay={140}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: COLORS.primary,
              }}
            />
            <Text
              style={{
                marginLeft: 7,
                fontSize: 10.5,
                fontWeight: "800",
                letterSpacing: 1.6,
                color: COLORS.primary,
                textTransform: "uppercase",
              }}
            >
              SafeSphere
            </Text>
          </View>

          <Text
            style={{
              fontSize: 30,
              fontWeight: "800",
              color: COLORS.text,
              letterSpacing: -0.8,
              lineHeight: 34,
              textTransform: "uppercase",
            }}
          >
            Your safety network
          </Text>
          <Text
            style={{
              fontSize: 30,
              fontWeight: "800",
              color: COLORS.textFaint,
              letterSpacing: -0.8,
              lineHeight: 34,
              textTransform: "uppercase",
            }}
          >
            is ready.
          </Text>
        </FadeUp>

        {/* Capability cards */}

        <FadeUp delay={320}>
          <View style={{ marginTop: 22, gap: 9 }}>
            <CapabilityCard
              icon="radio-button-on"
              title="One-tap emergency alert"
              description="Send an SOS with your live location"
              accent={COLORS.emergency}
              accentDim={COLORS.emergencyDim}
            />
            <CapabilityCard
              icon="navigate"
              title="Live location sharing"
              description="Keep trusted contacts informed"
              accent={COLORS.primary}
              accentDim={COLORS.primaryDim}
            />
            <CapabilityCard
              icon="shield-checkmark"
              title="Trusted response network"
              description="Connect with verified support"
              accent={COLORS.success}
              accentDim={COLORS.successDim}
            />
          </View>
        </FadeUp>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* SCREEN 2 — CTA                                                              */
/* -------------------------------------------------------------------------- */

function CTAScreen({
  onLogin,
  onRegister,
}: {
  onLogin: () => void;
  onRegister: () => void;
}) {
  const loginScale = useRef(new Animated.Value(1)).current;
  const registerScale = useRef(new Animated.Value(1)).current;

  const pressIn = (value: Animated.Value) => {
    Animated.spring(value, {
      toValue: 0.97,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = (value: Animated.Value) => {
    Animated.spring(value, {
      toValue: 1,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={{ width: W, flex: 1, backgroundColor: COLORS.background }}>
      {/* -------------------------------------------------------------- */}
      {/* Brand area                                                     */}
      {/* -------------------------------------------------------------- */}

      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 30,
        }}
      >
        <FadeUp>
          <View style={{ alignItems: "center" }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: COLORS.surface,
                borderWidth: 1,
                borderColor: COLORS.primaryLine,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 18,
              }}
            >
              <Ionicons
                name="shield-checkmark"
                size={24}
                color={COLORS.primary}
              />
            </View>

            <Text
              style={{
                fontSize: 30,
                fontWeight: "800",
                color: COLORS.text,
                letterSpacing: -0.8,
              }}
            >
              SafeSphere
            </Text>

            <Text
              style={{
                marginTop: 12,
                fontSize: 17,
                fontWeight: "600",
                color: COLORS.textDim,
                lineHeight: 24,
                textAlign: "center",
              }}
            >
              Safety should never{"\n"}be complicated.
            </Text>
          </View>
        </FadeUp>

        {/* Trust indicators */}

        <FadeUp delay={180}>
          <View
            style={{
              flexDirection: "row",
              marginTop: 34,
              backgroundColor: COLORS.surface,
              borderWidth: 1,
              borderColor: COLORS.line,
              borderRadius: 14,
              paddingVertical: 15,
            }}
          >
            {[
              { n: "01", label: "Fast alerts" },
              { n: "02", label: "Trusted contacts" },
              { n: "03", label: "Live location" },
            ].map((item, index) => (
              <View
                key={item.n}
                style={{
                  flex: 1,
                  alignItems: "center",
                  borderLeftWidth: index === 0 ? 0 : 1,
                  borderLeftColor: COLORS.line,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "700",
                    color: COLORS.primary,
                    letterSpacing: 1,
                  }}
                >
                  {item.n}
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 10.5,
                    fontWeight: "700",
                    color: COLORS.textDim,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                    textAlign: "center",
                  }}
                >
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        </FadeUp>
      </View>

      {/* -------------------------------------------------------------- */}
      {/* Floating CTA panel                                             */}
      {/* -------------------------------------------------------------- */}

      <FadeUp delay={260} dy={20}>
        <View
          style={{
            backgroundColor: COLORS.backgroundHi,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 1,
            borderColor: COLORS.line,
            borderBottomWidth: 0,
            paddingHorizontal: 24,
            paddingTop: 24,
            paddingBottom: 26,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 1.6,
              color: COLORS.textFaint,
              textTransform: "uppercase",
            }}
          >
            Get started
          </Text>

          <Animated.View
            style={{ transform: [{ scale: loginScale }], marginTop: 14 }}
          >
            <TouchableOpacity
              onPressIn={() => pressIn(loginScale)}
              onPressOut={() => pressOut(loginScale)}
              onPress={onLogin}
              activeOpacity={1}
              style={{
                height: 54,
                backgroundColor: COLORS.primary,
                borderRadius: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}
              >
                Sign in
              </Text>
              <Ionicons
                name="arrow-forward"
                size={16}
                color="#FFFFFF"
                style={{ marginLeft: 7 }}
              />
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={{ transform: [{ scale: registerScale }], marginTop: 10 }}
          >
            <TouchableOpacity
              onPressIn={() => pressIn(registerScale)}
              onPressOut={() => pressOut(registerScale)}
              onPress={onRegister}
              activeOpacity={1}
              style={{
                height: 50,
                borderWidth: 1,
                borderColor: COLORS.lineStrong,
                borderRadius: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ color: COLORS.text, fontSize: 14, fontWeight: "700" }}
              >
                Create account
              </Text>
              <Ionicons
                name="arrow-forward"
                size={14}
                color={COLORS.textDim}
                style={{ marginLeft: 6 }}
              />
            </TouchableOpacity>
          </Animated.View>

          <Text
            style={{
              marginTop: 16,
              fontSize: 10.5,
              color: COLORS.textFaint,
              textAlign: "center",
              lineHeight: 16,
            }}
          >
            By continuing, you agree to our{" "}
            <Text style={{ color: COLORS.textDim, fontWeight: "700" }}>
              Terms
            </Text>{" "}
            and{" "}
            <Text style={{ color: COLORS.textDim, fontWeight: "700" }}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </FadeUp>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* ROOT                                                                        */
/* -------------------------------------------------------------------------- */

export default function SafeSphereOnboarding() {
  const insets = useSafeAreaInsets();

  const [current, setCurrent] = useState(0);

  const flatRef = useRef<FlatList>(null);
  const redirectedRef = useRef(false);

  const { userDetails, isAuthenticated } = useContext(AuthContext);

  /* ---------------------------------------------------------------------- */
  /* Existing authentication redirect logic — unchanged                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const redirect = async () => {
      if (
        redirectedRef.current ||
        !isAuthenticated ||
        !userDetails?.phoneNumber
      ) {
        return;
      }

      redirectedRef.current = true;

      if (!userDetails.isVerified) {
        try {
          await api.post("/public-user/send-otp", {
            phoneNumber: userDetails.phoneNumber,
          });
        } catch {}

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

    void redirect();
  }, [isAuthenticated, userDetails]);

  /* ---------------------------------------------------------------------- */
  /* Screens — unchanged routes                                            */
  /* ---------------------------------------------------------------------- */

  const screens = [
    {
      key: "hero",
      component: <HeroScreen />,
    },
    {
      key: "cta",
      component: (
        <CTAScreen
          onLogin={() => router.replace("/auth/login")}
          onRegister={() => router.replace("/auth/register")}
        />
      ),
    },
  ];

  /* ---------------------------------------------------------------------- */
  /* Navigation — unchanged behavior                                       */
  /* ---------------------------------------------------------------------- */

  const goNext = () => {
    if (current === 0) {
      flatRef.current?.scrollToIndex({ index: 1, animated: true });
      setCurrent(1);
    }
  };

  const isLast = current === screens.length - 1;

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: COLORS.background,
      }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <FlatList
        ref={flatRef}
        data={screens}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <View style={{ width: W, flex: 1 }}>{item.component}</View>
        )}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      />

      {/* -------------------------------------------------------------- */}
      {/* Floating bottom navigation                                     */}
      {/* -------------------------------------------------------------- */}

      {!isLast && (
        <View
          style={{
            paddingHorizontal: 20,
            paddingBottom: 14,
            backgroundColor: COLORS.background,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: COLORS.surface,
              borderWidth: 1,
              borderColor: COLORS.line,
              borderRadius: 999,
              paddingLeft: 18,
              paddingRight: 6,
              paddingVertical: 6,
            }}
          >
            {/* Progress */}

            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              {screens.map((_, index) => (
                <View
                  key={index}
                  style={{
                    width: current === index ? 22 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor:
                      current === index ? COLORS.primary : COLORS.lineStrong,
                  }}
                />
              ))}
            </View>

            {/* Continue */}

            <TouchableOpacity
              onPress={goNext}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: COLORS.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
