import axios, { type AxiosInstance } from "axios";

const currentHost = typeof window !== "undefined" ? window.location.hostname : "localhost";

export const axiosInstance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || `http://${currentHost}:4000`,
  withCredentials: true,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

/** Bearer token saved at login (see pages/public/Authentication/Login.tsx). */
export const getStoredToken = (): string | undefined => {
  try {
    const stored = localStorage.getItem("safesphere-auth");
    return stored ? ((JSON.parse(stored) as { token?: string }).token ?? undefined) : undefined;
  } catch {
    return undefined;
  }
};

axiosInstance.interceptors.request.use((config) => {
  const methodsWithBody = ["post", "put", "patch"];

  if (methodsWithBody.includes(config.method?.toLowerCase() || "")) {
    config.headers["Content-Type"] = "application/json";
  }

  // Every admin endpoint needs the token; callers that pass one explicitly keep theirs.
  const token = getStoredToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});
