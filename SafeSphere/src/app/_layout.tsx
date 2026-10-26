import { Stack } from "expo-router";
import "../../global.css";
import AuthProvider from "../context/authContext";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SocketProvider } from "../context/socketContext";
import LocationTracker from "../components/location-tracker";
import { ActiveCaseProvider } from "../context/activeCase";
import { EmergencyCallProvider } from "../context/call";
import ShakeSOSListener from "../components/shake-sos-listener";
import GlobalShakeVoiceSOS from "../components/global-shake-voice-sos";

export default function RootLayout() {

  return (
    <SafeAreaProvider>

      <AuthProvider>
        <SocketProvider>
          {/* Open-case recovery (once per launch) and live location sharing for open cases. */}
          <ActiveCaseProvider>
          <EmergencyCallProvider>
            <LocationTracker />
            <ShakeSOSListener />

            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/login" />
              <Stack.Screen name="auth/register" />
              <Stack.Screen name="auth/verify-otp" />
              <Stack.Screen name="profile/create" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="case" />
              <Stack.Screen name="ongoing-case" />
              <Stack.Screen name="(tabs)" />
            </Stack>

            {/* Rendered after the stack so the voice SOS card sits above every screen. */}
            <GlobalShakeVoiceSOS />
          </EmergencyCallProvider>
          </ActiveCaseProvider>
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}