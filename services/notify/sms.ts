function hasTwilioEnv(): boolean {
  return !!(process.env.TWILIO_SID && process.env.TWILIO_AUTH && process.env.TWILIO_FROM);
}

export async function sendSms(input: {
  to: string;
  message: string;
}): Promise<{ ok: boolean; providerMessageId: string | null; skipped?: boolean; error?: string }> {
  if (!hasTwilioEnv()) {
    console.warn("[SMS] Skipped (Twilio env not set)", { to: input.to });
    return { ok: true, providerMessageId: null, skipped: true };
  }

  const sid = process.env.TWILIO_SID as string;
  const auth = process.env.TWILIO_AUTH as string;
  const from = process.env.TWILIO_FROM as string;

  const twilioMod = await import("twilio");
  const client = twilioMod.default(sid, auth);

  try {
    const res = await client.messages.create({ from, to: input.to, body: input.message });
    console.log("[SMS] SENT", { to: input.to, sid: res.sid });
    return { ok: true, providerMessageId: res.sid };
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMS_FAILED";
    console.error("[SMS] FAILED", { to: input.to, error: message });
    return { ok: false, error: message, providerMessageId: null };
  }
}
