import { Stack } from "expo-router";
import "../../global.css";
import AuthProvider from "../context/authContext";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SocketProvider } from "../context/socketContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>

      <AuthProvider>
        <SocketProvider>



    
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/login" />
              <Stack.Screen name="auth/register" />
              <Stack.Screen name="auth/verify-otp" />
              <Stack.Screen name="profile/create" />
              <Stack.Screen name="(tabs)" />
            </Stack>

        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}