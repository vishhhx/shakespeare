import { Redirect } from "expo-router";

/** Profile setup and editing moved to the onboarding flow; kept so existing links still work. */
export default function ProfileCreateRedirect() {
  return <Redirect href="/onboarding" />;
}
