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
import * as calls from "../call/call.controller";

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
publicUserRouter.patch("/emergency/:emergencyId/leave", requirePublicAuth, leaveEmergencyCase);
publicUserRouter.patch("/emergency/:emergencyId/responder-status", requirePublicAuth, updateMyResponderStatus);
publicUserRouter.post("/emergency/:emergencyId/location", requirePublicAuth, updateCaseLocation);
publicUserRouter.get("/emergency/ongoing-nearby", requirePublicAuth, getNearbyOngoingEmergencies);
publicUserRouter.get("/emergency/active", requirePublicAuth, getMyActiveEmergency);
publicUserRouter.get("/emergency/:emergencyId", requirePublicAuth, getEmergencyById);

// Emergency calls: the reporter calls the control center; invited volunteers / helpers join.
publicUserRouter.post("/calls/start", requirePublicAuth, calls.startCall);
publicUserRouter.get("/calls/mine", requirePublicAuth, calls.listMyCalls);
publicUserRouter.get("/calls/by-emergency/:emergencyId", requirePublicAuth, calls.getCallForEmergency);
publicUserRouter.get("/calls/:callId", requirePublicAuth, calls.getCall);
publicUserRouter.post("/calls/:callId/respond", requirePublicAuth, calls.respondToInvitation);
publicUserRouter.post("/calls/:callId/token", requirePublicAuth, calls.getMediaToken);
publicUserRouter.post("/calls/:callId/leave", requirePublicAuth, calls.leaveCall);
publicUserRouter.post("/calls/:callId/end", requirePublicAuth, calls.endCallForEveryone);

export default publicUserRouter;
