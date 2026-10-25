import bcrypt from "bcrypt";
import mongoose from "mongoose";
import connectToMongoDB from "../connections/mongodb";
import { AdminUserModel } from "../models/AuthadminUser/adminUser.model";

const CONTROLLER_CENTER_EMAIL = "controll@center.com";
const CONTROLLER_CENTER_PASSWORD = "whatthefuck";
const CONTROLLER_CENTER_NAME = "Control Center";

async function seedControllerCenter(): Promise<void> {
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
