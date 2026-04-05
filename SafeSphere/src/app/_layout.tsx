import { Stack } from "expo-router";
import "../../global.css";
import AuthProvider from "../context/authContext";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SocketProvider } from "../context/socketContext";
import LocationTracker from "../components/location-tracker";
import CaseResumeGuard from "../components/case-resume-guard";
import ShakeSOSListener from "../components/shake-sos-listener";
import GlobalShakeVoiceSOS from "../components/global-shake-voice-sos";

export default function RootLayout() {

  return (
    <SafeAreaProvider>

      <AuthProvider>
        <SocketProvider>

          <LocationTracker />
          <CaseResumeGuard />
          <ShakeSOSListener />
          <GlobalShakeVoiceSOS />



    
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/login" />
              <Stack.Screen name="auth/register" />
              <Stack.Screen name="auth/verify-otp" />
              <Stack.Screen name="profile/create" />
              <Stack.Screen name="case" />
              <Stack.Screen name="ongoing-case" />
              <Stack.Screen name="(tabs)" />
            </Stack>

        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}