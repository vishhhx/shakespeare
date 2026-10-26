// react-native-webrtc is a native module: it exists in a development/production build but not in
// Expo Go, where importing it throws at load time and takes the whole app down. Load it lazily so
// the rest of the app keeps working and only calls report that they need a build with WebRTC.
import { NativeModules } from "react-native";

type WebRTC = typeof import("react-native-webrtc");

const load = (): WebRTC | null => {
  if (!NativeModules.WebRTCModule) return null;
  try {
    const module: WebRTC = require("react-native-webrtc");
    // mediasoup-client expects the browser WebRTC globals (RTCPeerConnection, MediaStream, …).
    module.registerGlobals();
    return module;
  } catch {
    return null;
  }
};

export const webrtc = load();

export const WEBRTC_UNAVAILABLE_MESSAGE =
  "Video calls need the SafeSphere development build; they don't work in Expo Go.";
