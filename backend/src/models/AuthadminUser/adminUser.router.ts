import { Router } from "express";
import {
  createAdminUser,
  changeAdminPassword,
  adminUserLogin,
  getChallenge,
  sendAdminVerificationCode,
  verifyAdminVerificationCode,
  createAuthorityProfile,
} from "./admiinUser.controller";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware";
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
  getEmergencyVideoToken,
  flagEmergencyAsFake,
  getAllOngoingEmergenciesForControlCenter,
  rewardEmergencyParticipant,
} from "../emergency/emergency.controller";

const adminUserRouter = Router();

adminUserRouter.post("/register", createAdminUser);
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
adminUserRouter.post(
  "/emergency/:emergencyId/video/token",
  requireAuth,
  requireRoles(["authority", "responder", "controller-center"]),
  getEmergencyVideoToken,
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
  "/emergency/:emergencyId/leave",
  requireAuth,
  requireRoles(["responder", "authority", "volunteer"]),
  leaveEmergencyCase,
);

export default adminUserRouter;