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

export default adminUserRouter;