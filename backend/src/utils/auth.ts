type PublicUserLike = {
    _id: string;
    name?: string;
    email?: string;
    role: string;
    isprofileComplete?: boolean;
    fmtoken?: unknown;
};

export const safeParseUser=(data:PublicUserLike)=>{
        return{
            name:data.name,
            email:data.email,
            role:data.role,
            userId:data._id,
            isprofileComplete:data.isprofileComplete,
            fmtoken:data.fmtoken
        }
}