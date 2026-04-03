import type { Request, Response } from "express";
import { AdminChangePasswordSchema, AdminLoginSchema, AdminUserCreationSchema, AdminVerificationRequestSchema, AdminVerificationSchema } from "../../types/Auth";
import { AdminUserModel } from "./adminUser.model";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import crypto from "crypto";
import { ethers } from "ethers";
import redisService from "../../utils/redis";
import snsService from "../../utils/sns";

const generateVerificationCode = (length = 6): string => {
        const min = Math.pow(10, length - 1);
        const max = Math.pow(10, length) - 1;
        return String(Math.floor(Math.random() * (max - min + 1)) + min);
};
export const createAdminUser = async (req: Request, res: Response) => {
try {
    const parsed = AdminUserCreationSchema.safeParse(req.body);
    if(!parsed.success){
        return res.status(400).json({error:parsed.error.issues.map(e=>e.message).join(",")})    
    }

    const {email,password,name,role,publicKey}=parsed.data;

        const ExistingUser=await AdminUserModel.findOne({email});
        if(ExistingUser){
            return res.status(400).json({error:"User with this email already exists"})
        }

        const passwordHash=await bcrypt.hash(password,10);
        const isverified = role === "controller-center" || role === "authority";
        
        const newUser=await AdminUserModel.create({
            email,
            passwordHash,
            name,
            role,
            publicKey,
            isverified,
        })

        if (!isverified) {
            const verificationCode = generateVerificationCode(6);
            await redisService.storeVerificationCode(email, verificationCode, 300);
            await snsService.sendVerificationEmail(email, verificationCode, role);
        }

        const safeUser={
            userId:newUser._id,
            email:newUser.email,
            name:newUser.name,
            role:newUser.role,
            isverified: newUser.isverified,
        }

        return res.status(201).json({
            message:"Admin user created successfully",
            safeUser,
            verificationRequired: !isverified,
        })


} catch (error) {
    console.error("Error creating admin user:", error);
    return res.status(500).json({error:"Internal server error"});
}

}


export const sendAdminVerificationCode = async (req: Request, res: Response) => {
    try {
        const parsed = AdminVerificationRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(",") });
        }

        const { email } = parsed.data;
        const user = await AdminUserModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "Admin user not found" });
        }

        if (user.role === "controller-center") {
            return res.status(200).json({ message: "Controller-center users do not require verification" });
        }

        if (user.isverified) {
            return res.status(200).json({ message: "User is already verified" });
        }

        const verificationCode = generateVerificationCode(6);
        await redisService.storeVerificationCode(email, verificationCode, 300);
        await snsService.sendVerificationEmail(email, verificationCode, user.role);

        return res.status(200).json({ message: "Verification code sent successfully" });
    } catch (error) {
        console.error("Error sending admin verification code:", error);
        return res.status(500).json({ error: "Failed to send verification code" });
    }
};

export const verifyAdminVerificationCode = async (req: Request, res: Response) => {
    try {
        const parsed = AdminVerificationSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(",") });
        }

        const { email, code } = parsed.data;
        const user = await AdminUserModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "Admin user not found" });
        }

        if (user.role === "controller-center") {
            return res.status(200).json({ message: "Controller-center users do not require verification" });
        }

        const isValid = await redisService.verifyVerificationCode(email, code);
        if (!isValid) {
            return res.status(400).json({ message: "Invalid or expired verification code" });
        }

        if (!user.isverified) {
            user.isverified = true;
            await user.save();
        }

        const safeUser = {
            userId: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            isverified: user.isverified,
        };

        return res.status(200).json({ message: "Email verified successfully", safeUser });
    } catch (error) {
        console.error("Error verifying admin email:", error);
        return res.status(500).json({ error: "Failed to verify email" });
    }
};

export const getChallenge = async (req: Request, res: Response) => {
    const email = req.query.email as string;
    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    const user = await AdminUserModel.findOne({ email });
    if (!user) {
        return res.status(404).json({ message: "Admin user not found" });
    }

    if (user.role !== "authority") {
        return res.status(400).json({ message: "Challenge login is only available for authority users" });
    }

    if (!user.isverified) {
        return res.status(403).json({ message: "Email verification is required before requesting a challenge" });
    }

    const challenge = crypto.randomBytes(32).toString("hex");
    await redisService.storeChallenge(email, challenge, 300);
    console.log(`Generated challenge for ${email}: ${challenge}`);
    return res.json({ challenge })

}






export const  adminUserLogin=async(req:Request,res:Response)=>{
    try {
        const parsed = AdminLoginSchema.safeParse(req.body);
        if(!parsed.success){
            return res.status(400).json({error:parsed.error.issues.map(e=>e.message).join(",")})    
        }
        const {email,password,signature}=parsed.data
        const user=await AdminUserModel.findOne({email})
        if(!user){
            return res.status(400).json({message:'Invalid email or password'})
        }
        const isPasswordValid=await bcrypt.compare(password,user.passwordHash)
        if(!isPasswordValid){
            return res.status(400).json({message:'Invalid email or password'})
        }

        if (user.role !== "controller-center" && !user.isverified) {
            return res.status(403).json({message:'Email verification is required'})
        }

        if(user.role=="authority"){
    if(!signature){
        return res.status(400).json({message:'Signature is required for authority login'})
    }
    const challengeData = await redisService.getChallenge(email);
    if (!challengeData){
        return res.status(400).json({message:'No challenge found for this user'})
    }
  const recoveredAddress = ethers.verifyMessage(challengeData, signature);
  if(recoveredAddress.toLowerCase() !== user.publicKey?.toLowerCase()){
    return res.status(400).json({message:'Invalid signature'})
  }
  await redisService.deleteChallenge(email);
        }

        const safeUser={
            userId:user._id,
            email:user.email,
            name:user.name,
            role:user.role,
            isverified: user.isverified,
        }
        const token=jwt.sign(safeUser,env.jwtSecret,{expiresIn:env.jwtExpiresIn as jwt.SignOptions["expiresIn"]})
        return res.status(200).json({message:'Login successful',token,safeUser})
        
    } catch (error) {
        console.error("Error logging in admin user:", error);
        return res.status(500).json({message:'Internal server error'})
    }
}

export const changeAdminPassword = async (req: Request, res: Response) => {
    try {
        const parsed = AdminChangePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(",") });
        }

        const email = req.authUser?.email;
        if (!email) {
            return res.status(401).json({ message: "Authenticated admin email is required" });
        }

        const user = await AdminUserModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "Admin user not found" });
        }

        const { currentPassword, newPassword } = parsed.data;
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({ message: "Current password is incorrect" });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ message: "New password must be different from current password" });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await user.save();

        return res.status(200).json({
            message: "Password changed successfully",
            safeUser: {
                userId: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                isverified: user.isverified,
            },
        });
    } catch (error) {
        console.error("Error changing admin password:", error);
        return res.status(500).json({ message: "Failed to change password" });
    }
};