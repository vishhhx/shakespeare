
import { axiosInstance } from "@/utils";

export const AuthServices = {
  googleOauthInit: async () => {
    try {
      const response = await axiosInstance.get("/auth/google/oauth-init");
      return response.data;
    } catch (error) {
      console.error("Error in AuthServices.googleOauthInit:", error);
      throw error;
    }
  },

  githubOauthInit: async () => {
    try {
      const response = await axiosInstance.get("/auth/github/oauth-init");
      return response.data;
    } catch (error) {
      console.error("Error in AuthServices.githubOauthInit:", error);
      throw error;
    }
  },

  login: async (credentials: { email: string; password: string }) => {
    try {
      const response = await axiosInstance.post("/auth/login", credentials, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      console.error("Error in AuthServices.login:", error);
      throw error;
    }
  },

  adminRegister: async (data: {
    name: string;
    email: string;
    password: string;
    role: "responder" | "authority";
    publicKey?: string;
    /** Required for responders: the authority they work for. */
    authorityProfileId?: string;
  }) => {
    // Requires a control-center session; the token is attached by the axios interceptor.
    const response = await axiosInstance.post("/api/admin-user/register", data, {
      withCredentials: true,
    });
    return response.data;
  },

  adminSendVerificationCode: async (email: string) => {
    const response = await axiosInstance.post(
      "/api/admin-user/send-verification-code",
      { email },
      { withCredentials: true },
    );
    return response.data;
  },

  adminVerifyVerificationCode: async (email: string, code: string) => {
    const response = await axiosInstance.post(
      "/api/admin-user/verify-verification-code",
      { email, code },
      { withCredentials: true },
    );
    return response.data;
  },

  adminChallenge: async (email: string) => {
    const response = await axiosInstance.get("/api/admin-user/challenge", {
      withCredentials: true,
      params: { email },
    });
    return response.data;
  },

  adminLogin: async (credentials: {
    email: string;
    password: string;
    role: "responder" | "authority" | "controller-center";
    signature?: string;
  }) => {
    const response = await axiosInstance.post("/api/admin-user/login", credentials, {
      withCredentials: true,
    });
    return response.data;
  },

  adminChangePassword: async (payload: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.post("/api/admin-user/change-password", payload, {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  },

  adminCreateAuthorityProfile: async (payload: {
    userId: string;
    organizationName: string;
    authorityType: "police" | "hospital" | "fire" | "ngo" | "other";
    contactNumber: string;
    officialEmail: string;
    address: string;
    location: { lat: number; lng: number };
    officerName?: string;
    designation?: string;
  }) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.post("/api/admin-user/authority-profile", payload, {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    return response.data;
  },

  applyVolunteer: async (payload: {
    skills: string[];
    experience?: string;
    documents: Array<{ name: string; url: string }>;
    preferredRoles: Array<"medical" | "rescue" | "logistics" | "general">;
    availability: { isAvailable: boolean; timeSlots?: string[] };
    location: { lat: number; lng: number };
  }) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.post("/api/public-user/apply-volunteer", payload, {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  },

  getMyVolunteerApplication: async () => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.get("/api/public-user/volunteer-application", {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  },

  getAssignedVolunteerApplications: async () => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.get("/api/admin-user/volunteer-applications/assigned", {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  },

  reviewVolunteerApplication: async (
    applicationId: string,
    payload: { status: "approved" | "rejected"; reviewNotes?: string },
  ) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.patch(
      `/api/admin-user/volunteer-applications/${applicationId}/review`,
      payload,
      {
        withCredentials: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    return response.data;
  },

  acceptEmergencyResponse: async (emergencyId: string) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.post(
      "/api/admin-user/emergency/respond",
      { emergencyId },
      {
        withCredentials: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    return response.data;
  },

  getControlCenterOngoingEmergencies: async () => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.get("/api/admin-user/emergency/ongoing", {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    return response.data;
  },

  getDirectiveEmergencies: async () => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.get("/api/admin-user/emergency/directives", {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    return response.data;
  },

  getEmergencyById: async (emergencyId: string) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.get(`/api/admin-user/emergency/${emergencyId}`, {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    return response.data as {
      emergency: {
        emergencyId: string;
        title: string;
        description?: string;
        type: string;
        severity: string;
        status: string;
        relationToVictim?: string;
        location?: { lat?: number; lng?: number; address?: string };
        victimsCount?: number;
        respondersConnected: number;
        responders: {
          userId: string;
          role: "volunteer" | "authority";
          status: "assigned" | "enroute" | "on_scene" | "completed";
          location?: { lat?: number; lng?: number } | null;
          joinedAt?: string;
        }[];
        media?: {
          type: "image" | "video" | "audio";
          url: string;
          signedUrl?: string;
        }[];
        participants?: {
          userId: string;
          role: "reporter" | "volunteer" | "authority";
          status?: string;
          joinedAt?: string;
        }[];
        victims?: unknown[];
        timeline?: unknown[];
        distanceFromRequesterKm?: number | null;
        createdAt?: string;
        updatedAt?: string;
      };
      privileges?: {
        canEditCase?: boolean;
        canCloseCase?: boolean;
        canBroadcastUpdates?: boolean;
        canViewReporterDetails?: boolean;
      };
    };
  },

  getEmergencyVideoToken: async (emergencyId: string) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.post(
      `/api/admin-user/emergency/${emergencyId}/video/token`,
      {},
      {
        withCredentials: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );

    return response.data as {
      emergencyId: string;
      roomName: string;
      identity: string;
      token: string;
      expiresIn: number;
      participants: { userId: string; role: "reporter" | "volunteer" | "authority" | "controller-center" }[];
    };
  },

  closeEmergencyCase: async (emergencyId: string) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.patch(
      `/api/admin-user/emergency/${emergencyId}/close`,
      {},
      {
        withCredentials: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );

    return response.data;
  },

  leaveEmergencyCase: async (emergencyId: string) => {
    const storedAuth = localStorage.getItem("safesphere-auth");
    const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

    const response = await axiosInstance.patch(
      `/api/admin-user/emergency/${emergencyId}/leave`,
      {},
      {
        withCredentials: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );

    return response.data;
  },

  register: async (data: { name: string; email: string; password: string }) => {
    try {
      const response = await axiosInstance.post("/auth/register", data, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      console.error("Error in AuthServices.register:", error);
      throw error;
    }
  },
  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout", {}, { withCredentials: true });
    } catch (error) {
      console.error("Error in AuthServices.logout:", error);
      throw error;
    }
  },

  getCurrentUser: async () => {
    try {
      const response = await axiosInstance.get("/auth/me", {
        withCredentials: true,
      });
      return response.data.data;
    } catch (error) {
      console.error("Error in AuthServices.getCurrentUser:", error);
      throw error;
    }
  },

  getPresignedReadUrl: async (key: string) => {
    try {
      const storedAuth = localStorage.getItem("safesphere-auth");
      const token = storedAuth ? (JSON.parse(storedAuth) as { token?: string }).token : undefined;

      const response = await axiosInstance.post(
        "/api/public-user/read-url",
        { key },
        {
          withCredentials: true,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      return response.data.url;
    } catch (error) {
      console.error("Error in AuthServices.getPresignedReadUrl:", error);
      throw error;
    }
  },
};
