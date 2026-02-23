function hasTwilioEnv() {
  return !!(process.env.TWILIO_SID && process.env.TWILIO_AUTH && process.env.TWILIO_FROM);
}

async function sendSms({ to, message }) {
  // If Twilio isn't configured, do not crash the system
  if (!hasTwilioEnv()) {
    console.warn("[SMS] Skipped (Twilio env not set)", { to });
    return { ok: true, providerMessageId: null, skipped: true };
  }

  const sid = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_FROM;

  // Lazy import so we only require twilio if configured
  const twilio = require("twilio");
  const client = twilio(sid, auth);

  try {
    const res = await client.messages.create({ from, to, body: message });
    console.log("[SMS] SENT", { to, sid: res.sid });
    return { ok: true, providerMessageId: res.sid };
  } catch (e) {
    console.error("[SMS] FAILED", { to, error: e?.message || e });
    return { ok: false, error: e?.message || "SMS_FAILED" };
  }
}

module.exports = { sendSms };
