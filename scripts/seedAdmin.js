require("dotenv").config();

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const { connectMongo } = require("../db/mongo");
const User = require("../models/User");

// from .env
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "System Admin";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE; // REQUIRED by your schema

async function seedAdmin() {
  try {
    await connectMongo();

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_PHONE) {
      throw new Error(
        "Missing required env vars. Please set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_PHONE in .env"
      );
    }

    const exists = await User.findOne({ email: ADMIN_EMAIL });
    if (exists) {
      console.log(" Admin already exists — skipping");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      phone: ADMIN_PHONE,
      passwordHash, // IMPORTANT: your schema requires passwordHash
      role: "ADMIN",
    });

    console.log(" Admin seeded successfully");
    process.exit(0);
  } catch (err) {
    console.error(" Seed failed:", err.message);
    process.exit(1);
  }
}

seedAdmin();
