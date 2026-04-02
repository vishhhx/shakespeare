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