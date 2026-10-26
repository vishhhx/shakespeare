import { createContext, useContext } from "react";

import type { CallSnapshot } from "@/lib/mediaCall";
import type { CallView } from "@/services/callServices";

export type ActiveCall = { callId: string; view: CallView | null; media: CallSnapshot };

export type CallsContextValue = {
  /** Control center: open calls (ringing first). Others: empty. */
  incoming: CallView[];
  /** Invitations waiting for my answer. */
  invitations: CallView[];
  /** Calls I'm already part of but not connected to (e.g. after a browser refresh). */
  resumable: CallView[];
  active: ActiveCall | null;
  busy: string | null;
  answer: (callId: string) => Promise<void>;
  decline: (callId: string) => Promise<void>;
  respond: (callId: string, accept: boolean) => Promise<void>;
  rejoin: (callId: string) => Promise<void>;
  startForEmergency: (emergencyId: string) => Promise<void>;
  leave: () => Promise<void>;
  endForEveryone: () => Promise<void>;
  setMic: (on: boolean) => void;
  setCamera: (on: boolean) => void;
  refresh: () => void;
};

export const CallsContext = createContext<CallsContextValue | null>(null);

export function useCalls() {
  const value = useContext(CallsContext);
  if (!value) throw new Error("useCalls must be used inside CallProvider");
  return value;
}
