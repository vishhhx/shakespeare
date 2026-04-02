import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
    authUser?: {
      userId: string;
      email: string;
      role: string;
      name: string;
    };
  }
}

export {};
