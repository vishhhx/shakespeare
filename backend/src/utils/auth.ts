import type { IUser } from "../types/auth";

export const safeParseUser=(data:IUser)=>{
        return{
            name:data.name,
            email:data.email,
            role:data.role,
            userId:data._id,
            isprofileComplete:data.isprofileComplete,
            fmtoken:data.fmtoken
        }
}