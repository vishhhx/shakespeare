import { Router } from "express";
import {
  createAdminUser,
  changeAdminPassword,
  adminUserLogin,
  getChallenge,
  sendAdminVerificationCode,
  verifyAdminVerificationCode,
  createAuthorityProfile,
  listAuthorityProfiles,
} from "./admiinUser.controller";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware";
import * as calls from "../call/call.controller";
import {
  getAssignedVolunteerApplications,
  reviewVolunteerApplication,
} from "../ProfilePublicUser/profile.controller";
import {
  acceptEmergencyResponse,
  closeEmergencyCase,
  leaveEmergencyCase,
  getDirectiveEmergencies,
  getEmergencyById,
  flagEmergencyAsFake,
  getAllOngoingEmergenciesForControlCenter,
  rewardEmergencyParticipant,
  updateEmergencyStatus,
  updateMyResponderStatus,
  updateCaseLocation,
  listAssignableResponders,
  assignResponderToEmergency,
} from "../emergency/emergency.controller";

const adminUserRouter = Router();

// Accounts are provisioned by the control center; the first control-center account comes from
// src/scripts/seedControllerCenter.ts. Never trust a role from an unauthenticated request.
adminUserRouter.post("/register", requireAuth, requireRoles(["controller-center"]), createAdminUser);
adminUserRouter.post("/send-verification-code", sendAdminVerificationCode);
adminUserRouter.post("/verify-verification-code", verifyAdminVerificationCode);
adminUserRouter.get("/challenge", getChallenge);
adminUserRouter.post("/login", adminUserLogin);
adminUserRouter.post(
  "/change-password",
  requireAuth,
  requireRoles(["responder", "authority", "controller-center"]),
  changeAdminPassword,
);
adminUserRouter.post('/authority-profile', requireAuth, requireRoles(["controller-center"]), createAuthorityProfile);
adminUserRouter.get(
  "/volunteer-applications/assigned",
  requireAuth,
  requireRoles(["authority"]),
  getAssignedVolunteerApplications,
);
adminUserRouter.patch(
  "/volunteer-applications/:applicationId/review",
  requireAuth,
  requireRoles(["authority"]),
  reviewVolunteerApplication,
);
adminUserRouter.post(
  "/emergency/respond",
  requireAuth,
  requireRoles(["responder", "authority", "controller-center"]),
  acceptEmergencyResponse,
);
adminUserRouter.get(
  "/emergency/ongoing",
  requireAuth,
  requireRoles(["controller-center"]),
  getAllOngoingEmergenciesForControlCenter,
);
adminUserRouter.get(
  "/emergency/directives",
  requireAuth,
  requireRoles(["authority", "responder", "controller-center"]),
  getDirectiveEmergencies,
);
adminUserRouter.get(
  "/emergency/:emergencyId",
  requireAuth,
  requireRoles(["authority", "responder", "controller-center"]),
  getEmergencyById,
);
adminUserRouter.patch(
  "/emergency/:emergencyId/close",
  requireAuth,
  requireRoles(["authority", "controller-center"]),
  closeEmergencyCase,
);
adminUserRouter.post(
  "/emergency/:emergencyId/flag-fake",
  requireAuth,
  requireRoles(["responder", "authority", "controller-center"]),
  flagEmergencyAsFake,
);
adminUserRouter.post(
  "/emergency/:emergencyId/reward-participant",
  requireAuth,
  requireRoles(["authority", "controller-center"]),
  rewardEmergencyParticipant,
);
adminUserRouter.patch(
  "/emergency/:emergencyId/status",
  requireAuth,
  requireRoles(["responder", "authority", "controller-center"]),
  updateEmergencyStatus,
);
adminUserRouter.patch(
  "/emergency/:emergencyId/responder-status",
  requireAuth,
  requireRoles(["responder", "authority"]),
  updateMyResponderStatus,
);
adminUserRouter.post(
  "/emergency/:emergencyId/location",
  requireAuth,
  requireRoles(["responder", "authority"]),
  updateCaseLocation,
);
adminUserRouter.post(
  "/emergency/:emergencyId/assign",
  requireAuth,
  requireRoles(["authority", "controller-center"]),
  assignResponderToEmergency,
);
adminUserRouter.get(
  "/authorities",
  requireAuth,
  requireRoles(["controller-center"]),
  listAuthorityProfiles,
);
adminUserRouter.get(
  "/responders",
  requireAuth,
  requireRoles(["authority", "controller-center"]),
  listAssignableResponders,
);
adminUserRouter.patch(
  "/emergency/:emergencyId/leave",
  requireAuth,
  requireRoles(["responder", "authority", "volunteer"]),
  leaveEmergencyCase,
);

// Emergency calls (media on the SafeSphere SFU). Every rule is checked inside the handlers.
const staff = [requireAuth, requireRoles(["responder", "authority", "controller-center"])];
adminUserRouter.get("/calls/incoming", requireAuth, requireRoles(["controller-center"]), calls.listIncomingCalls);
adminUserRouter.get("/calls/mine", ...staff, calls.listMyCalls);
adminUserRouter.get("/calls/by-emergency/:emergencyId", ...staff, calls.getCallForEmergency);
adminUserRouter.post("/calls/start", requireAuth, requireRoles(["controller-center"]), calls.startCall);
adminUserRouter.get("/calls/:callId", ...staff, calls.getCall);
adminUserRouter.post("/calls/:callId/answer", requireAuth, requireRoles(["controller-center"]), calls.answerCall);
adminUserRouter.post("/calls/:callId/decline", requireAuth, requireRoles(["controller-center"]), calls.declineIncomingCall);
adminUserRouter.get("/calls/:callId/invitable", requireAuth, requireRoles(["authority", "controller-center"]), calls.listInvitable);
adminUserRouter.post("/calls/:callId/invite", requireAuth, requireRoles(["authority", "controller-center"]), calls.inviteToCall);
adminUserRouter.post("/calls/:callId/respond", ...staff, calls.respondToInvitation);
adminUserRouter.post("/calls/:callId/token", ...staff, calls.getMediaToken);
adminUserRouter.post("/calls/:callId/leave", ...staff, calls.leaveCall);
adminUserRouter.post("/calls/:callId/end", ...staff, calls.endCallForEveryone);

export default adminUserRouter;