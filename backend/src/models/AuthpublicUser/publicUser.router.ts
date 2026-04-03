import { Router } from "express";
import {
	getPreSignedUrl,
	registerPublicUser,
	SendOtp,
	updatePublicUserProfile,
	verifyPublicUser,
	updateUserLocation,
} from "./publicUser.controller";
import { requirePublicAuth } from "../../middleware/auth.middleware";
import {
	createVolunteerApplication,
	getMyVolunteerApplication,
	getPublicUserProfile,
	upsertPublicUserProfile,
} from "../ProfilePublicUser/profile.controller";

const publicUserRouter = Router();

publicUserRouter.post("/register", registerPublicUser);
publicUserRouter.post("/send-otp", SendOtp);
publicUserRouter.post("/verify", verifyPublicUser);
publicUserRouter.post("/upload-url", requirePublicAuth, getPreSignedUrl);
publicUserRouter.patch("/profile", requirePublicAuth, updatePublicUserProfile);
publicUserRouter.post("/profile", requirePublicAuth, upsertPublicUserProfile);
publicUserRouter.get("/profile", requirePublicAuth, getPublicUserProfile);
publicUserRouter.post("/apply-volunteer", requirePublicAuth, createVolunteerApplication);
publicUserRouter.get("/volunteer-application", requirePublicAuth, getMyVolunteerApplication);
publicUserRouter.post("/location", requirePublicAuth, updateUserLocation);

export default publicUserRouter;
