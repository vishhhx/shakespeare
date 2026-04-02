import { Router } from "express";
import {
	getPreSignedUrl,
	registerPublicUser,
	SendOtp,
	updatePublicUserProfile,
	verifyPublicUser,
} from "./publicUser.controller";
import { requirePublicAuth } from "../../middleware/auth.middleware";

const publicUserRouter = Router();

publicUserRouter.post("/register", registerPublicUser);
publicUserRouter.post("/send-otp", SendOtp);
publicUserRouter.post("/verify", verifyPublicUser);
publicUserRouter.post("/upload-url", requirePublicAuth, getPreSignedUrl);
publicUserRouter.patch("/profile", requirePublicAuth, updatePublicUserProfile);

export default publicUserRouter;
