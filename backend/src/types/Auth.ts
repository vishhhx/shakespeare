import z from "zod"

const normalizeIndianPhoneNumber = (input: string): string | null => {
  const digits = input.replace(/\D/g, "");

  // Accept plain 10-digit Indian mobile number.
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }

  // Accept 0-prefixed Indian mobile number (e.g. 09876...).
  if (digits.length === 11 && digits.startsWith("0")) {
    const local = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(local)) {
      return `+91${local}`;
    }
  }

  // Accept country-code prefixed number without plus (e.g. 9198...).
  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(local)) {
      return `+91${local}`;
    }
  }

  return null;
};

const indianPhoneSchema = z.string().trim().transform((value, ctx) => {
  const normalized = normalizeIndianPhoneNumber(value);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Only valid Indian mobile numbers are allowed",
    });
    return z.NEVER;
  }

  return normalized;
});

export type roles=
  "public" | "volunteer" | "responder" | "authority"



export interface AuthPlayload {
    userId: string;
   phoneNumber: string;
  name: string;
  role: string;
  isVerified: boolean;
  avatarUrl: string,
  isprofileComplete: boolean
  email?: string;
}


export const PublicauthSchema=z.object({
    phoneNumber: indianPhoneSchema,
    role:z.enum(["public","volunteer"])
    
})

export const SendOtpSchema = z.object({
  phoneNumber: indianPhoneSchema,
});

export const VerifyOtpSchema = z.object({
  phoneNumber: indianPhoneSchema,
  otp: z.string().regex(/^\d{4,8}$/),
});

export const UpdatePublicProfileSchema = z.object({
  name: z.string().trim().min(2).max(50),
  avatarUrl: z.string().trim().min(1),
});

export const UpsertPublicProfileSchema = z.object({
  name: z.string().trim().min(2).max(50),
  age: z.number().int().min(1).max(120).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  profileImage: z.string().trim().optional(),
  userType: z.enum(["medical", "fire", "police", "ngo", "other"]).default("other"),
  faceEmbeddingPhoto: z.string().trim().min(1, "Face photo is required"),
  contacts: z.array(
    z.object({
      name: z.string().trim().min(2),
      phoneNumber: indianPhoneSchema,
      relation: z.string().trim().optional(),
      isPrimary: z.boolean().optional(),
    }),
  ).default([]),
  appContacts: z.array(z.string().min(1)).default([]),
  medicalRecord: z.object({
    bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]),
    allergies: z.array(z.string().trim()).default([]),
    medications: z.array(z.string().trim()).default([]),
    diseases: z.array(z.string().trim()).default([]),
    notes: z.string().trim().optional(),
  }),
  sosMessage: z.string().trim().optional(),
  autoShareMedical: z.boolean().optional(),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  enableContinuousTracking: z.boolean().optional(),
});

export const VolunteerApplicationCreateSchema = z.object({
  skills: z.array(z.string().trim().min(2)).min(1),
  experience: z.string().trim().optional(),
  documents: z.array(z.object({
    name: z.string().trim().min(1),
    url: z.string().trim().min(1),
  })).default([]),
  preferredRoles: z.array(z.enum(["medical", "rescue", "logistics", "general"]))
    .min(1)
    .default(["general"]),
  availability: z.object({
    isAvailable: z.boolean().default(true),
    timeSlots: z.array(z.string().trim()).optional(),
  }),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
});

export const VolunteerApplicationReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNotes: z.string().trim().optional(),
});


export const AdminUserCreationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(2).max(50),
  role: z.enum(["responder", "authority","controller-center"]),
  publicKey: z.string().optional(),
}).refine((data) => {
  if (data.role === "authority") {
    return !!data.publicKey;
  }
  return true;
}, {
  message: "Public key is required for authority role",   
});


export const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  signature: z.string().optional(), 
  role: z.enum(["responder", "authority","controller-center"]).optional(),
});

export const AdminVerificationSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{4,8}$/),
});

export const AdminVerificationRequestSchema = z.object({
  email: z.string().email(),
});

export const AdminChangePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
  confirmNewPassword: z.string().min(8),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"],
});

export const CreateAuthorityProfileSchema = z.object({
  userId: z.string().min(1),
  organizationName: z.string().trim().min(2),
  authorityType: z.enum(["police", "hospital", "fire", "ngo", "other"]),
  contactNumber: z.string().trim().min(7),
  officialEmail: z.string().email(),
  address: z.string().trim().min(5),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  officerName: z.string().trim().optional(),
  designation: z.string().trim().optional(),
});


