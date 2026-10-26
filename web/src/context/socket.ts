import { createContext, useContext, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";

export type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
};

/** Provided by SocketProvider (./socketContext.tsx). */
export const SocketContext = createContext<SocketContextValue | undefined>(undefined);

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }

  return context;
}

/** Subscribe to a socket event for the lifetime of the component (re-attached on reconnect). */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/** Same as useSocketEvent for several events sharing one handler. */
export function useSocketEvents(events: readonly string[], handler: () => void) {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  const key = events.join("|");

  useEffect(() => {
    if (!socket) return;
    const listener = () => handlerRef.current();
    const names = key.split("|");
    for (const name of names) socket.on(name, listener);
    return () => {
      for (const name of names) socket.off(name, listener);
    };
  }, [socket, key]);
}
