import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";

import { AuthContext } from "./authContext";
import { SocketContext } from "./socketContext";
import {
  cancelEmergencyCall,
  getApiErrorMessage,
  getCall,
  getCallForEmergency,
  getCallMediaToken,
  leaveEmergencyCall,
  respondToCallInvitation,
  startEmergencyCall,
} from "../lib/api";
import type { CallView, MediaPayload } from "../lib/callTypes";
import { MediaCall, type CallSnapshot } from "../lib/mediaCall";
import EmergencyCallSheet from "../components/call/EmergencyCallSheet";

type ActiveCall = { callId: string; emergencyId: string; view: CallView | null; media: CallSnapshot };

type CallContextValue = {
  active: ActiveCall | null;
  sheetVisible: boolean;
  showSheet: () => void;
  hideSheet: () => void;
  /** Join (or rejoin) the open call of an emergency; starts one if the reporter has none. */
  joinForEmergency: (emergencyId: string, options?: { video?: boolean }) => Promise<void>;
  leave: () => Promise<void>;
  /** Caller only, while still ringing. */
  cancel: () => Promise<void>;
  setMic: (on: boolean) => void;
  setCamera: (on: boolean) => void;
};

const CallContext = createContext<CallContextValue | null>(null);

export function useEmergencyCall() {
  const value = useContext(CallContext);
  if (!value) throw new Error("useEmergencyCall must be used inside EmergencyCallProvider");
  return value;
}

const CALL_EVENTS = ["call:answered", "call:updated", "call:ended", "connect"];

/** One emergency call at a time, kept alive while the person moves between screens. */
export function EmergencyCallProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useContext(AuthContext);
  const { on, off } = useContext(SocketContext);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const sessionRef = useRef<MediaCall | null>(null);
  const activeRef = useRef<{ callId: string; version: number } | null>(null);

  const refreshView = useCallback(async () => {
    const current = activeRef.current;
    if (!current) return;
    try {
      const { call } = await getCall(current.callId);
      if (call.version < current.version) return;
      current.version = call.version;
      setActive((value) => (value && value.callId === call.callId ? { ...value, view: call } : value));
      // Ended by the control center, or because the case was closed.
      if (call.status === "ended" || call.status === "failed") void sessionRef.current?.leave();
    } catch {
      // next event retries
    }
  }, []);

  const open = useCallback(
    async (view: CallView, firstMedia?: MediaPayload, video = true) => {
      if (sessionRef.current) await sessionRef.current.leave();
      let pending: MediaPayload | undefined = firstMedia;
      const session = new MediaCall({
        getCredentials: async () => {
          if (pending) {
            const media = pending;
            pending = undefined;
            return media;
          }
          return (await getCallMediaToken(view.callId)).media;
        },
      });
      sessionRef.current = session;
      activeRef.current = { callId: view.callId, version: view.version };
      session.subscribe((media) => {
        setActive((current) => ({
          callId: view.callId,
          emergencyId: view.emergencyId,
          view: current?.callId === view.callId ? current.view ?? view : view,
          media,
        }));
      });
      setSheetVisible(true);
      await session.start({ video });
      void refreshView();
    },
    [refreshView],
  );

  const joinForEmergency = useCallback(
    async (emergencyId: string, options?: { video?: boolean }) => {
      try {
        let { call } = await getCallForEmergency(emergencyId);
        if (!call) call = (await startEmergencyCall(emergencyId)).call;
        if (active?.callId === call.callId && active.media.connection !== "ended" && active.media.connection !== "failed") {
          setSheetVisible(true);
          return;
        }
        await open(call, undefined, options?.video ?? true);
      } catch (error) {
        Alert.alert("Couldn't join the call", getApiErrorMessage(error));
      }
    },
    [active, open],
  );

  // Invitations (volunteers / helpers on a case) arrive over the socket.
  useEffect(() => {
    const onInvitation = (payload: { callId?: string; emergencyId?: string; invitedBy?: string; emergency?: { title?: string } }) => {
      if (!payload?.callId) return;
      Alert.alert(
        "Join the emergency call?",
        `${payload.invitedBy ?? "The control center"} invites you to the call for “${payload.emergency?.title ?? "an emergency"}”. Your camera and microphone are used only if you allow them.`,
        [
          { text: "Decline", style: "cancel", onPress: () => void respondToCallInvitation(payload.callId!, false).catch(() => undefined) },
          {
            text: "Join",
            onPress: () =>
              void (async () => {
                try {
                  const { call, media } = await respondToCallInvitation(payload.callId!, true);
                  if (payload.emergencyId) router.push({ pathname: "/case", params: { emergencyId: payload.emergencyId } });
                  await open(call, media);
                } catch (error) {
                  Alert.alert("Couldn't join the call", getApiErrorMessage(error));
                }
              })(),
          },
        ],
      );
    };
    const onCallEvent = (payload: { callId?: string; version?: number }) => {
      if (!payload?.callId || payload.callId === activeRef.current?.callId) void refreshView();
    };
    on("call:invitation", onInvitation);
    for (const event of CALL_EVENTS) on(event, onCallEvent);
    return () => {
      off("call:invitation", onInvitation);
      for (const event of CALL_EVENTS) off(event, onCallEvent);
    };
  }, [on, off, open, refreshView]);

  // Signing out ends any call and releases the camera and microphone.
  useEffect(() => {
    if (isAuthenticated) return;
    void sessionRef.current?.leave();
    sessionRef.current = null;
    activeRef.current = null;
    setActive(null);
  }, [isAuthenticated]);

  const clear = () => {
    sessionRef.current = null;
    activeRef.current = null;
    setActive(null);
    setSheetVisible(false);
  };

  const value = useMemo<CallContextValue>(
    () => ({
      active,
      sheetVisible,
      showSheet: () => setSheetVisible(true),
      hideSheet: () => setSheetVisible(false),
      joinForEmergency,
      leave: async () => {
        const callId = activeRef.current?.callId;
        await sessionRef.current?.leave();
        clear();
        if (callId) await leaveEmergencyCall(callId).catch(() => undefined);
      },
      cancel: async () => {
        const callId = activeRef.current?.callId;
        if (!callId) return;
        try {
          await cancelEmergencyCall(callId);
        } catch (error) {
          Alert.alert("Couldn't cancel", getApiErrorMessage(error));
          return;
        }
        await sessionRef.current?.leave();
        clear();
      },
      setMic: (on: boolean) => void sessionRef.current?.setMicEnabled(on),
      setCamera: (on: boolean) => void sessionRef.current?.setCameraEnabled(on),
    }),
    [active, sheetVisible, joinForEmergency],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <EmergencyCallSheet />
    </CallContext.Provider>
  );
}
