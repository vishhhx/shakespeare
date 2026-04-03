import type { Request, Response } from "express";
import { PublicauthSchema, SendOtpSchema, UpdatePublicProfileSchema, VerifyOtpSchema } from "../../types/Auth";
import { PublicUserModel } from "./publicUser.model";
import redisService from "../../utils/redis";
import snsService from "../../utils/sns";
import { signToken } from "../../utils/jwt";
import s3Service from "../../utils/s3";

const generateOtp = (length = 6): string => {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
};

export const registerPublicUser=async(req:Request,res:Response)=>{
console.log("Received registration request with data:", req.body);
    try{
            const parsedData = PublicauthSchema.safeParse(req.body);
            if(!parsedData.success){
                return res.status(400).json({ error: "Invalid input data" });
            }

            const { phoneNumber, role } = parsedData.data;
            const existingUser = await PublicUserModel.findOne({ phoneNumber });
            if (existingUser) {
                return res.status(400).json({ error: "User with this phone number already exists" });
            }
            const newUser = await PublicUserModel.create({
                phoneNumber,
                role,
            });
            return res.status(201).json({ message: "User registered successfully", user: newUser });    

    }
    catch(error){
        console.error("Error registering user:", error);
        return res.status(500).json({ error: "Internal server error" });
    }




}



export const SendOtp=async(req:Request,res:Response)=>{
    try {
        const parsedData = SendOtpSchema.safeParse(req.body);
        if (!parsedData.success) {
            return res.status(400).json({ error: "Invalid phone number" });
        }

        const { phoneNumber } = parsedData.data;
        console.log("Send OTP request for phone number:", phoneNumber); 
        const user = await PublicUserModel.findOne({ phoneNumber });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const otp = generateOtp(6);
        await redisService.storeOtp(phoneNumber, otp, 300);
        await snsService.sendOtp(phoneNumber, otp);

        return res.status(200).json({ message: "OTP sent successfully" });
        
    } catch (error) {
        console.error("Error sending OTP:", error);
        return res.status(500).json({ error: "Failed to send OTP" });
    }
}


export const verifyPublicUser=async(req:Request,res:Response)=>{
    try {
        console.log("Verify OTP request:", req.body);
        const parsedData = VerifyOtpSchema.safeParse(req.body);
        if (!parsedData.success) {
            console.warn("Verify OTP validation failed:", parsedData.error.flatten());
            return res.status(400).json({ error: "Invalid verification data" });
        }

        const { phoneNumber, otp } = parsedData.data;
        console.log("Verify OTP normalized phone:", phoneNumber);
        const user = await PublicUserModel.findOne({ phoneNumber });
        if (!user) {
            console.warn("Verify OTP user not found:", phoneNumber);
            return res.status(404).json({ error: "User not found" });
        }

        const isValidOtp = await redisService.verifyOtp(phoneNumber, otp);
        if (!isValidOtp) {
            console.warn("Verify OTP failed: invalid or expired OTP", { phoneNumber });
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        if (!user.isVerified) {
            user.isVerified = true;
            await user.save();
        }

        const safeUser = {
            name: user.name?? "",
            _id: String(user._id),
            userId: String(user._id),
            phoneNumber: user.phoneNumber,
            role: user.role,
            isVerified: user.isVerified,
            avatarUrl: user.avatarUrl?? "",
            isprofileComplete: user.isprofileComplete,
        }
        const token=signToken(safeUser)

if(!token){                                                     
    return res.status(500).json({message:"Error generating token"})
}

        return res.status(200).json({ message: "User verified successfully", user: safeUser, token });


        
    } catch (error) {
        console.error("Error verifying user:", error);
        return res.status(500).json({ error: "Failed to verify user" });
    }
}

export const getPreSignedUrl = async (req: Request, res: Response) => {
    const { key, contentType } = req.body as { key?: string; contentType?: string };

    if (!key) {
        return res.status(400).json({ error: "Key is required" });
    }

    try {
        const uploadContentType =
          typeof contentType === "string" && contentType.trim().length > 0
            ? contentType.trim()
            : "application/octet-stream";

        const url = await s3Service.signUploadUrl(String(key), uploadContentType);
        return res.status(200).json({ url });
    } catch (error) {
        console.error("Error generating pre-signed URL:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const updatePublicUserProfile = async (req: Request, res: Response) => {
    try {
        const parsedData = UpdatePublicProfileSchema.safeParse(req.body);
        if (!parsedData.success) {
            return res.status(400).json({ error: "Invalid profile data" });
        }

        const userId = req.authUser?.userId;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const user = await PublicUserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const { name, avatarUrl } = parsedData.data;
        user.name = name;
        user.avatarUrl = avatarUrl;
        user.isprofileComplete = true;

        await user.save();

        return res.status(200).json({
            message: "Profile updated successfully",
            user: {
                _id: String(user._id),
                userId: String(user._id),
                phoneNumber: user.phoneNumber,
                name: user.name ?? "",
                role: user.role,
                isVerified: user.isVerified,
                avatarUrl: user.avatarUrl ?? "",
                isprofileComplete: user.isprofileComplete,
            },
        });
    } catch (error) {
        console.error("Error updating profile:", error);
        return res.status(500).json({ error: "Failed to update profile" });
    }
};