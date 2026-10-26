import { Router } from "express";
import {
	getPreSignedUrl,
	getPreSignedReadUrl,
	registerPublicUser,
	SendOtp,
	updatePublicUserProfile,
	verifyPublicUser,
	updateUserLocation,
} from "./publicUser.controller";
import { requirePublicAuth } from "../../middleware/auth.middleware";
import {
	createVolunteerApplication,
	getAllAppUsers,
	getMyVolunteerApplication,
	getPublicUserProfile,
	upsertPublicUserProfile,
} from "../ProfilePublicUser/profile.controller";
import {
	acceptEmergencyResponse,
	chatWithEmergencyBot,
	enqueueVoiceEmergencyAnalysis,
	flagEmergencyAsFake,
	getEmergencyVideoToken,
	getVoiceEmergencyAnalysis,
	leaveEmergencyCase,
	getEmergencyById,
	getNearbyOngoingEmergencies,
	initiateEmergency,
	processEmergencyStrangerPhoto,
	getMyActiveEmergency,
	updateCaseLocation,
	updateMyResponderStatus,
} from "../emergency/emergency.controller";

const publicUserRouter = Router();

publicUserRouter.post("/register", registerPublicUser);
publicUserRouter.post("/send-otp", SendOtp);
publicUserRouter.post("/verify", verifyPublicUser);
publicUserRouter.post("/upload-url", requirePublicAuth, getPreSignedUrl);
publicUserRouter.post("/read-url", requirePublicAuth, getPreSignedReadUrl);
publicUserRouter.patch("/profile", requirePublicAuth, updatePublicUserProfile);
publicUserRouter.post("/profile", requirePublicAuth, upsertPublicUserProfile);
publicUserRouter.get("/profile", requirePublicAuth, getPublicUserProfile);
publicUserRouter.get("/app-users", requirePublicAuth, getAllAppUsers);
publicUserRouter.post("/apply-volunteer", requirePublicAuth, createVolunteerApplication);
publicUserRouter.get("/volunteer-application", requirePublicAuth, getMyVolunteerApplication);
publicUserRouter.post("/location", requirePublicAuth, updateUserLocation);
publicUserRouter.post("/emergency/process-stranger", requirePublicAuth, processEmergencyStrangerPhoto);
publicUserRouter.post("/emergency/chatbot", requirePublicAuth, chatWithEmergencyBot);
publicUserRouter.post("/emergency/voice/enqueue", requirePublicAuth, enqueueVoiceEmergencyAnalysis);
publicUserRouter.get("/emergency/voice/analysis", requirePublicAuth, getVoiceEmergencyAnalysis);
publicUserRouter.post("/emergency/initiate", requirePublicAuth, initiateEmergency);
publicUserRouter.post("/emergency/:emergencyId/flag-fake", requirePublicAuth, flagEmergencyAsFake);
publicUserRouter.post("/emergency/respond", requirePublicAuth, acceptEmergencyResponse);
publicUserRouter.post("/emergency/:emergencyId/video/token", requirePublicAuth, getEmergencyVideoToken);
publicUserRouter.patch("/emergency/:emergencyId/leave", requirePublicAuth, leaveEmergencyCase);
publicUserRouter.patch("/emergency/:emergencyId/responder-status", requirePublicAuth, updateMyResponderStatus);
publicUserRouter.post("/emergency/:emergencyId/location", requirePublicAuth, updateCaseLocation);
publicUserRouter.get("/emergency/ongoing-nearby", requirePublicAuth, getNearbyOngoingEmergencies);
publicUserRouter.get("/emergency/active", requirePublicAuth, getMyActiveEmergency);
publicUserRouter.get("/emergency/:emergencyId", requirePublicAuth, getEmergencyById);

export default publicUserRouter;
