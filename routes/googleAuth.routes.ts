import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { getGoogleAuthUrl, exchangeCodeForTokens } from "../services/googleCalendar.js";
import { asString, errorMessage } from "../utils/errors.js";

const router = Router();

router.get("/google/connect", authRequired, (_req, res) => {
  return res.redirect(getGoogleAuthUrl());
});

router.get("/oauth2callback", async (req, res) => {
  try {
    const code = asString(req.query.code);
    if (!code) return res.status(400).send("Missing code");

    const tokens = await exchangeCodeForTokens(code);
    return res.json({
      ok: true,
      message: "Copy refresh_token into your .env / Render env as GOOGLE_REFRESH_TOKEN",
      tokens,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) || "OAuth callback failed" });
  }
});

export default router;
