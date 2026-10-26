import { axiosInstance } from "@/utils/axiosInstance";
import type { CaseDetails, CasePermissions, DirectiveCase, LatLng, ResponderStatus } from "@/lib/emergency";

const base = "/api/admin-user";

export type AssignableResponder = {
  userId: string;
  name: string;
  email: string;
  organization: { authorityProfileId: string; name: string; type: string } | null;
  online: boolean;
};

export type AuthorityOption = { authorityProfileId: string; userId: string; name: string; type: string; address?: string };

/** Admin emergency API. The auth token is attached by the axios interceptor. */
export const EmergencyServices = {
  async directives() {
    const { data } = await axiosInstance.get(`${base}/emergency/directives`);
    return data as { count: number; directives: DirectiveCase[]; requesterLocation: LatLng | null };
  },
  async details(emergencyId: string) {
    const { data } = await axiosInstance.get(`${base}/emergency/${emergencyId}`);
    return data as { emergency: CaseDetails; permissions: CasePermissions };
  },
  async accept(emergencyId: string, location?: LatLng | null) {
    const { data } = await axiosInstance.post(`${base}/emergency/respond`, { emergencyId, location: location ?? undefined });
    return data as { message: string; trackingNotice: string };
  },
  async setStatus(emergencyId: string, action: "verify" | "resolve", note?: string) {
    const { data } = await axiosInstance.patch(`${base}/emergency/${emergencyId}/status`, { action, note });
    return data as { status: string };
  },
  async close(emergencyId: string, reason?: string) {
    const { data } = await axiosInstance.patch(`${base}/emergency/${emergencyId}/close`, { reason });
    return data;
  },
  async leave(emergencyId: string) {
    const { data } = await axiosInstance.patch(`${base}/emergency/${emergencyId}/leave`, {});
    return data;
  },
  async flagFake(emergencyId: string, reason?: string) {
    const { data } = await axiosInstance.post(`${base}/emergency/${emergencyId}/flag-fake`, { reason });
    return data as { uniqueFlags: number; threshold: number; reporterBlocked?: boolean };
  },
  async reward(emergencyId: string, participantUserId: string, points: number, note?: string) {
    const { data } = await axiosInstance.post(`${base}/emergency/${emergencyId}/reward-participant`, { participantUserId, points, note });
    return data as { awardedPoints: number; totalPoints: number };
  },
  async myStatus(emergencyId: string, status: Exclude<ResponderStatus, "assigned">) {
    const { data } = await axiosInstance.patch(`${base}/emergency/${emergencyId}/responder-status`, { status });
    return data;
  },
  async shareLocation(emergencyId: string, location: LatLng & { recordedAt: string }) {
    const { data } = await axiosInstance.post(`${base}/emergency/${emergencyId}/location`, location);
    return data;
  },
  async responders() {
    const { data } = await axiosInstance.get(`${base}/responders`);
    return data as { responders: AssignableResponder[] };
  },
  async assign(emergencyId: string, responderUserId: string) {
    const { data } = await axiosInstance.post(`${base}/emergency/${emergencyId}/assign`, { responderUserId });
    return data as { message: string };
  },
  async authorities() {
    const { data } = await axiosInstance.get(`${base}/authorities`);
    return data as { authorities: AuthorityOption[] };
  },
};
