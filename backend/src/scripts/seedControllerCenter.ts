import bcrypt from "bcrypt";
import mongoose from "mongoose";
import connectToMongoDB from "../connections/mongodb";
import { AdminUserModel } from "../models/AuthadminUser/adminUser.model";

// The only way to create a control-center account (POST /api/admin-user/register refuses it).
// Credentials come from the environment so no password lives in the repository:
//   CONTROLLER_CENTER_PASSWORD=... [CONTROLLER_CENTER_EMAIL=...] bun run seed:controller-center
const CONTROLLER_CENTER_EMAIL = process.env.CONTROLLER_CENTER_EMAIL || "controll@center.com";
const CONTROLLER_CENTER_PASSWORD = process.env.CONTROLLER_CENTER_PASSWORD || "";
const CONTROLLER_CENTER_NAME = process.env.CONTROLLER_CENTER_NAME || "Control Center";

async function seedControllerCenter(): Promise<void> {
  if (CONTROLLER_CENTER_PASSWORD.length < 12) {
    console.error("Set CONTROLLER_CENTER_PASSWORD (at least 12 characters) to seed the control-center account.");
    process.exit(1);
  }

  try {
    await connectToMongoDB();

    const passwordHash = await bcrypt.hash(CONTROLLER_CENTER_PASSWORD, 10);

    const seededUser = await AdminUserModel.findOneAndUpdate(
      { email: CONTROLLER_CENTER_EMAIL },
      {
        $set: {
          name: CONTROLLER_CENTER_NAME,
          role: "controller-center",
          passwordHash,
          isverified: true,
          isprofileComplete: true,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    console.log("Controller-center user seeded successfully:", {
      userId: seededUser?._id,
      email: seededUser?.email,
      role: seededUser?.role,
      isverified: seededUser?.isverified,
      isprofileComplete: seededUser?.isprofileComplete,
    });
  } catch (error) {
    console.error("Failed to seed controller-center user:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

await seedControllerCenter();
