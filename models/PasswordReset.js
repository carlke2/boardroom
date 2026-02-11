// models/PasswordReset.js
const mongoose = require("mongoose");

const PasswordResetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Store HASH of token, not the token itself
    tokenHash: { type: String, required: true, unique: true, index: true },

    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Optional: auto-clean after expiry (Mongo TTL)
// NOTE: TTL deletes docs after expiresAt time passes.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PasswordReset", PasswordResetSchema);
