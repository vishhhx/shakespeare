import type { NextFunction, Request, Response } from "express";

import { verifyToken } from "../utils/jwt";
import { AdminUserModel } from "../models/AuthadminUser/adminUser.model";
import { PublicUserModel } from "../models/AuthpublicUser/publicUser.model";

const isAdminRole = (role: string): role is "responder" | "authority" | "controller-center" => {
  return role === "responder" || role === "authority" || role === "controller-center";
};

const isPublicRole = (role: string): role is "public" | "volunteer" => {
  return role === "public" || role === "volunteer";
};

type AllowedRole = "public" | "volunteer" | "responder" | "authority" | "controller-center";

export const requireRoles = (allowedRoles: AllowedRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.authUser?.role;
    if (!role || !allowedRoles.includes(role as AllowedRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
};

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieToken = req.cookies?.token;
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  return null;
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    if (!payload.role) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    let userId = payload.userId;
    let name = payload.name ?? "";
    let email = payload.email ?? "";
    let phoneNumber = payload.phoneNumber ?? "";

    if (!userId) {
      if (isAdminRole(payload.role)) {
        if (!email) {
          return res.status(401).json({ error: "Invalid admin token payload" });
        }

        const adminUser = await AdminUserModel.findOne({ email })
          .select("_id name email role isverified")
          .lean();

        if (!adminUser) {
          return res.status(401).json({ error: "Admin user not found for token" });
        }

        if (adminUser.role !== "controller-center" && !adminUser.isverified) {
          return res.status(401).json({ error: "Admin user email not verified" });
        }

        userId = String(adminUser._id);
        name = adminUser.name;
        email = adminUser.email;
      } else if (isPublicRole(payload.role)) {
        if (!phoneNumber) {
          return res.status(401).json({ error: "Invalid public token payload" });
        }

        const publicUser = await PublicUserModel.findOne({ phoneNumber })
          .select("_id name phoneNumber role")
          .lean();

        if (!publicUser) {
          return res.status(401).json({ error: "Public user not found for token" });
        }

        userId = String(publicUser._id);
        name = publicUser.name ?? "";
        phoneNumber = publicUser.phoneNumber;
      } else {
        return res.status(401).json({ error: "Unsupported role in token" });
      }
    }

    req.userId = userId;
    req.authUser = {
      userId,
      email,
      phoneNumber,
      role: payload.role,
      name,
    };

    return next();
  } catch (error) {
    console.error("Error in requireAuth middleware:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const requirePublicAuth = [requireAuth, requireRoles(["public", "volunteer"])];
export const requireAdminAuth = [requireAuth, requireRoles(["responder", "authority", "controller-center"])];
