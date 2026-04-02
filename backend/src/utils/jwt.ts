import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

import type { AuthPlayload } from "../types/auth";
import { env } from "../config/env";

export function signToken(payload: AuthPlayload): string {
  const options: SignOptions = {
  expiresIn:'7d'
  };
  return jwt.sign(payload, env.jwtSecret as Secret, options);
}

export function verifyToken(token: string): AuthPlayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as AuthPlayload;
  } catch (error) {
    return null;
  }
}