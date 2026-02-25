const { Resend } = require("resend");
const PQueue = require("p-queue").default;

/* ===================================================
   ENV HELPERS
=================================================== */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function normalizeEmailList(value) {
  if (!value) return [];

  const arr = Array.isArray(value) ? value : [value];

  return arr
    .flatMap((x) => String(x).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ===================================================
   RESEND CLIENT
=================================================== */
let cachedResend = null;

function getResend() {
  if (cachedResend) return cachedResend;
  cachedResend = new Resend(requireEnv("RESEND_API_KEY"));
  return cachedResend;
}

/* ===================================================
   EMAIL QUEUE (SAFE RATE LIMIT)
   1 email / second → NEVER hits 429
=================================================== */
const emailQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 1,
});

/* ===================================================
   FROM ADDRESS
=================================================== */
function buildFrom() {
  const from = process.env.MAIL_FROM;

  if (!from) {
    throw new Error(
      "MAIL_FROM missing. Example: Boardroom <no-reply@bms.millenium.co.ke>"
    );
  }

  return from;
}

/* ===================================================
   DEFAULT SECRETARY EMAIL
=================================================== */
function getSecretaryEmail() {
  return process.env.SECRETARY_EMAIL || null;
}

/* ===================================================
   SEND EMAIL
=================================================== */
async function sendEmail({
  to,
  cc,
  bcc,
  subject,
  html,
  text,
  attachments,
  replyTo,
}) {
  const resend = getResend();

  const toList = normalizeEmailList(to);
  const ccList = normalizeEmailList(cc);
  const bccList = normalizeEmailList(bcc);

  if (!toList.length) {
    throw new Error("No recipient provided");
  }

  /* ========= ALWAYS ADD SECRETARY ========= */
  const secretary = getSecretaryEmail();

  if (secretary) {
    if (!ccList.includes(secretary)) {
      ccList.push(secretary);
    }
  }

  const payload = {
    from: buildFrom(),
    to: toList,
    cc: ccList.length ? ccList : undefined,
    bcc: bccList.length ? bccList : undefined,
    subject,
    html: html || undefined,
    text: text || undefined,
    reply_to: replyTo || process.env.MAIL_REPLY_TO || undefined,
    attachments: Array.isArray(attachments)
      ? attachments.map((a) => ({
          filename: a.filename || "attachment",
          content: a.content,
          contentType: a.contentType || a.mimetype,
        }))
      : undefined,
  };

  try {
    const { data, error } = await emailQueue.add(async () => {
      try {
        return await resend.emails.send(payload);
      } catch (err) {
        if (err?.statusCode === 429) {
          console.log("Rate limited → retrying...");
          await new Promise((r) => setTimeout(r, 1500));
          return resend.emails.send(payload);
        }
        throw err;
      }
    });

    if (error) {
      console.error("EMAIL FAILED", error);
      return { ok: false, error };
    }

    console.log("EMAIL SENT", {
      to: payload.to,
      cc: payload.cc,
      id: data?.id,
    });

    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("EMAIL FAILED", err);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendEmail };