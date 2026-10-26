import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CallsContext, type ActiveCall } from "@/context/calls";
import { useSocket, useSocketEvents } from "@/context/socket";
import { MediaCall, type CallSnapshot } from "@/lib/mediaCall";
import { errorMessage } from "@/lib/emergency";
import { CallServices, type CallView } from "@/services/callServices";
import { useAppSelector } from "@/store/hooks";
import authorityAlertAudio from "@/assets/WhatsApp Audio 2026-04-05 at 1.05.00 AM (1).mpeg";
import IncomingCallTray from "./IncomingCallTray";
import CallWindow from "./CallWindow";

const CALL_EVENTS = ["call:incoming", "call:answered", "call:updated", "call:ended", "call:invitation", "connect"] as const;

const isOpen = (call: CallView) => call.status === "ringing" || call.status === "active";

/**
 * Owns the one emergency call this browser tab can be in, plus the lists that feed the
 * incoming-call tray. Server state comes from the API; media state from MediaCall.
 */
export default function CallProvider({ children }: { children: ReactNode }) {
  const role = useAppSelector((state) => state.auth.authData?.role);
  const { socket } = useSocket();
  const [incoming, setIncoming] = useState<CallView[]>([]);
  const [mine, setMine] = useState<CallView[]>([]);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sessionRef = useRef<MediaCall | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const ringingSeen = useRef(new Set<string>());

  const loadLists = useCallback(async () => {
    try {
      const [incomingResponse, mineResponse] = await Promise.all([
        role === "controller-center" ? CallServices.incoming() : Promise.resolve({ calls: [] as CallView[] }),
        CallServices.mine(),
      ]);
      setIncoming(incomingResponse.calls);
      setMine(mineResponse.calls);
      // Ring once per new incoming call or invitation, even if it arrived before this page loaded.
      const ringing = [
        ...incomingResponse.calls.filter((call) => call.status === "ringing" && !call.answeredBy),
        ...mineResponse.calls.filter((call) => call.me?.inviteStatus === "invited"),
      ];
      for (const call of ringing) {
        if (ringingSeen.current.has(call.callId)) continue;
        ringingSeen.current.add(call.callId);
        void new Audio(authorityAlertAudio).play().catch(() => undefined);
      }
    } catch {
      // keep the last lists on transient failures
    }
  }, [role]);

  const refreshActive = useCallback(async () => {
    const callId = activeIdRef.current;
    if (!callId) return;
    try {
      const { call } = await CallServices.get(callId);
      if (call.version < versionRef.current) return;
      versionRef.current = call.version;
      setActive((current) => (current && current.callId === callId ? { ...current, view: call } : current));
    } catch {
      // ignore; next event retries
    }
  }, []);

  const refresh = useCallback(() => {
    void loadLists();
    void refreshActive();
  }, [loadLists, refreshActive]);

  useEffect(() => {
    if (!socket) return;
    void loadLists();
    const timer = setInterval(() => void loadLists(), 20000);
    return () => clearInterval(timer);
  }, [socket, loadLists]);

  useSocketEvents(CALL_EVENTS, refresh);

  // A call ended by someone else (or by closing the case) ends our media too.
  useEffect(() => {
    if (active?.view && !isOpen(active.view) && active.media.connection !== "ended") {
      void sessionRef.current?.leave();
    }
  }, [active?.view, active?.media.connection]);

  const openSession = useCallback(
    async (callId: string, view: CallView | null, firstCredentials?: { token: string; mediaUrl: string }) => {
      if (sessionRef.current) await sessionRef.current.leave();
      let pending = firstCredentials;
      const session = new MediaCall({
        // The first join reuses the token from answer/accept; rejoins fetch a fresh one.
        getCredentials: async () => {
          if (pending) {
            const credentials = pending;
            pending = undefined;
            return credentials;
          }
          const { media } = await CallServices.token(callId);
          return media;
        },
      });
      sessionRef.current = session;
      activeIdRef.current = callId;
      versionRef.current = view?.version ?? 0;
      session.subscribe((media: CallSnapshot) => {
        setActive((current) => ({ callId, view: current?.callId === callId ? current.view : view, media }));
      });
      await session.start({ video: true });
      void refreshActive();
    },
    [refreshActive],
  );

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work."));
    } finally {
      setBusy(null);
      void loadLists();
    }
  };

  const value = useMemo(
    () => ({
      incoming,
      invitations: mine.filter((call) => call.me?.inviteStatus === "invited" && isOpen(call)),
      resumable: mine.filter(
        (call) => isOpen(call) && ["accepted", "caller"].includes(call.me?.inviteStatus ?? "") && call.callId !== active?.callId,
      ),
      active,
      busy,
      answer: (callId: string) =>
        run(`answer:${callId}`, async () => {
          const { call, media } = await CallServices.answer(callId);
          await openSession(callId, call, media);
        }),
      decline: (callId: string) => run(`decline:${callId}`, async () => void (await CallServices.decline(callId))),
      respond: (callId: string, accept: boolean) =>
        run(`respond:${callId}`, async () => {
          const { call, media } = await CallServices.respond(callId, accept);
          if (accept && media) await openSession(callId, call, media);
        }),
      rejoin: (callId: string) => run(`rejoin:${callId}`, async () => openSession(callId, null)),
      startForEmergency: (emergencyId: string) =>
        run(`start:${emergencyId}`, async () => {
          const { call } = await CallServices.start(emergencyId);
          await openSession(call.callId, call);
        }),
      leave: () =>
        run("leave", async () => {
          const callId = activeIdRef.current;
          await sessionRef.current?.leave();
          sessionRef.current = null;
          activeIdRef.current = null;
          setActive(null);
          if (callId) await CallServices.leave(callId).catch(() => undefined);
        }),
      endForEveryone: () =>
        run("end", async () => {
          const callId = activeIdRef.current;
          if (!callId) return;
          await CallServices.end(callId);
          await sessionRef.current?.leave();
          sessionRef.current = null;
          activeIdRef.current = null;
          setActive(null);
        }),
      setMic: (on: boolean) => void sessionRef.current?.setMicEnabled(on),
      setCamera: (on: boolean) => void sessionRef.current?.setCameraEnabled(on),
      refresh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` only closes over stable setters
    [incoming, mine, active, busy, openSession, refresh],
  );

  // Release the camera/microphone if the tab navigates away from the signed-in area.
  useEffect(() => () => void sessionRef.current?.leave(), []);

  return (
    <CallsContext.Provider value={value}>
      {children}
      <IncomingCallTray />
      {active && <CallWindow />}
    </CallsContext.Provider>
  );
}
