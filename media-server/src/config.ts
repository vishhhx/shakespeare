import os from "node:os";
import { readFileSync } from "node:fs";

// Loads media-server/.env if present (KEY=value lines), without overriding the real environment.
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env file: rely on the environment
}

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see media-server/.env.example)`);
  return value;
};

/** First non-internal IPv4 address, for local testing from phones on the same Wi-Fi. */
const lanAddress = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address ?? "127.0.0.1";

export const config = {
  /** Socket.IO signaling + internal HTTP endpoints. */
  port: Number(process.env.MEDIA_PORT || 4443),
  /** Must match the API's MEDIA_TOKEN_SECRET: tokens are minted there and verified here. */
  tokenSecret: required("MEDIA_TOKEN_SECRET"),
  /** Shared with the API for service-to-service calls in both directions. */
  internalSecret: required("MEDIA_INTERNAL_SECRET"),
  apiInternalUrl: (process.env.API_INTERNAL_URL || "http://127.0.0.1:4000").replace(/\/$/, ""),
  corsOrigins: (process.env.MEDIA_CORS_ORIGINS || "*").split(",").map((origin) => origin.trim()),
  rtc: {
    /** UDP and TCP port for all media (open both in the firewall). One port per worker. */
    port: Number(process.env.RTC_PORT || 40000),
    listenIp: process.env.RTC_LISTEN_IP || "0.0.0.0",
    /** Address clients send media to: the server's public IP or DNS name in production. */
    announcedAddress: process.env.RTC_ANNOUNCED_ADDRESS || lanAddress(),
  },
  workers: Math.max(1, Math.min(os.cpus().length, Number(process.env.MEDIA_WORKERS || 1))),
  maxPeersPerRoom: Number(process.env.MAX_PEERS_PER_ROOM || 12),
  /** An empty room keeps its router this long so a refreshing participant rejoins instantly. */
  emptyRoomTtlMs: 60_000,
};
