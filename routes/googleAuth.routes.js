const express = require("express");
const { authRequired } = require("../middleware/auth");
const { getGoogleAuthUrl, exchangeCodeForTokens } = require("../services/googleCalendar");

const router = express.Router();

// Step 1: open this in browser
router.get("/google/connect", authRequired, (req, res) => {
  const url = getGoogleAuthUrl();
  return res.redirect(url);
});

// Step 2: Google redirects here with ?code=...
router.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    const tokens = await exchangeCodeForTokens(code);

    // IMPORTANT: refresh_token shows only on first consent or when prompt=consent
    return res.json({
      ok: true,
      message: "Copy refresh_token into your .env / Render env as GOOGLE_REFRESH_TOKEN",
      tokens,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || "OAuth callback failed" });
  }
});

module.exports = router;
