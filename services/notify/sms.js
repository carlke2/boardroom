const twilio = require("twilio");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;

  const sid = requireEnv("TWILIO_SID");
  const token = requireEnv("TWILIO_AUTH_TOKEN");
  cachedClient = twilio(sid, token);
  return cachedClient;
}

async function sendSms({ to, message }) {
  const client = getClient();
  const from = requireEnv("TWILIO_PHONE");

  try {
    const resp = await client.messages.create({
      to,
      from,
      body: message
    });

    console.log("✅ SMS SENT", { to, sid: resp.sid, status: resp.status });
    return { ok: true, sid: resp.sid, status: resp.status };
  } catch (err) {
    console.error("❌ SMS FAILED", { to, error: err.message });
    throw err;
  }
}

module.exports = { sendSms };
