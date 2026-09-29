import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectMongo } from "../db/mongo.js";
import User from "../models/User.js";

const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "System Admin";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE;

async function seedAdmin(): Promise<void> {
  try {
    await connectMongo();

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_PHONE) {
      throw new Error(
        "Missing required env vars. Please set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_PHONE in .env"
      );
    }

    const email = ADMIN_EMAIL.trim().toLowerCase();
    const phone = ADMIN_PHONE.trim();

    const existingAdmin = await User.findOne({ role: "ADMIN" });
    if (existingAdmin) {
      console.log(" Admin already exists — skipping");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({
      name: ADMIN_NAME.trim(),
      email,
      phone,
      passwordHash,
      role: "ADMIN",
      active: true,
    });

    console.log(" Admin seeded successfully");
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(" Seed failed:", message);
    process.exit(1);
  }
}

void seedAdmin();
