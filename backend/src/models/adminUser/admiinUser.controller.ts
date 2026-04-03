import type { Request, Response } from "express";
import { AdminUserCreationSchema } from "../../types/Auth";
import { AdminUserModel } from "./adminUser.model";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import crypto from "crypto";
import { ethers } from "ethers";
declare global {
  var challengeStore: {
    challenge: string;
    userId: string;
  } | undefined;
}
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
        
        const newUser=await AdminUserModel.create({
            email,
            passwordHash,
            name,
            role,
            publicKey
        })

        const safeUser={
            userId:newUser._id,
            email:newUser.email,
            name:newUser.name,
            role:newUser.role,
        }

        return res.status(201).json({message:"Admin user created successfully",safeUser})


} catch (error) {
    console.error("Error creating admin user:", error);
    return res.status(500).json({error:"Internal server error"});
}

}


export const getChallenge=(Request:Request,res:Response)=>{
    const email=Request.query.email as string
    if(!email){
        return res.status(400).json({message:'Email is required'})
    }
    const challenge=crypto.randomBytes(32).toString('hex')
global.challengeStore = {
    challenge,
    userId: email,
  };//make this store in the redis
    console.log(`Generated challenge for ${email}: ${challenge}`)
    res.json({challenge})

}





// export const login=async(Request:Request,res:Response)=>{
//  try {   const {email,password,signature}=Request.body

//  console.log('Received login request with body:', Request.body);
//     if(!email || !password || !signature){
//         return res.status(400).json({message:'All fields are required'})
//     }
//     const user=await AdminUserModel.findOne({email})
//     if(!user){
//         return res.status(400).json({message:'Invalid email or password'})
//     }
//     const isPasswordValid=await bcrypt.compare(password,user.passwordHash)
//     if(!isPasswordValid){
//         return res.status(400).json({message:'Invalid email or password'})
//     }
//     const challengeData = global.challengeStore;
//     if (!challengeData || challengeData.userId !== email){
//         return res.status(400).json({message:'No challenge found for this user'})
//     }
//   const recoveredAddress = ethers.verifyMessage(challengeData.challenge, signature);
//   if(recoveredAddress !== user.publicKey){
//     return res.status(400).json({message:'Invalid signature'})
//   }
//   global.challengeStore = undefined;//remove from  redis
//   const safeUser={
//     userId:user._id,
//     email:user.email,
//     name:user.name,
//     role:user.role,
//   }
//     const token=jwt.sign(safeUser,env.jwtSecret,{expiresIn:'1h'})
//   }
//    return res.status(200).json({message:'Login successful',data:{token,email:user.email}})

    
//  } catch (error) {
//     console.error('Error during login:', error);
//     res.status(500).json({message:'Internal server error'})
//  }}

const 