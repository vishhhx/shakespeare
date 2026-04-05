import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "../config/env";

let qdrantClient: QdrantClient | null = null;

const normalizeQdrantUrl = (url?: string): string | null => {
  if (!url || typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/$/, "");
};

export const connectToQdrant = async (): Promise<QdrantClient | null> => {
  const url = normalizeQdrantUrl(env.QDRANT_URL);
  if (!url) {
    console.warn("[Qdrant] QDRANT_URL is not set. Qdrant features will be disabled.");
    return null;
  }

  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url,
      apiKey: env.QDRANT_API_KEY,
      checkCompatibility: false,
    });
  }

  try {
    await qdrantClient.getCollections();
    console.log("[Qdrant] Connected");
    return qdrantClient;
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;

    if (status === 401 || status === 403) {
      console.error("[Qdrant] Authentication failed. Check QDRANT_API_KEY permissions for this cluster.");
    } else {
      console.error("[Qdrant] Connection failed:", error);
    }

    // Keep backend running even if Qdrant is unavailable.
    qdrantClient = null;
    return null;
  }
};

export const getQdrantClient = (): QdrantClient | null => {
  return qdrantClient;
};
