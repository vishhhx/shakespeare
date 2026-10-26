import { useContext } from "react";
import { Redirect, Stack } from "expo-router";
import { AuthContext } from "../../context/authContext";
import { OnboardingDraftProvider } from "../../context/onboardingDraft";

export default function OnboardingLayout() {
  const { isAuthenticated } = useContext(AuthContext);

  // Onboarding is only reachable once signed in.
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <OnboardingDraftProvider>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", gestureEnabled: true }}>
        <Stack.Screen name="index" options={{ animation: "fade" }} />
        <Stack.Screen name="done" options={{ animation: "fade", gestureEnabled: false }} />
      </Stack>
    </OnboardingDraftProvider>
  );
}
