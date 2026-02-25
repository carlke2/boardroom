const { Resend } = require("resend");
const PQueue = require("p-queue").default;

/* ================================
   ENV HELPERS
================================ */
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

/* ================================
   RESEND CLIENT (CACHED)
================================ */
let cachedResend = null;

function getResend() {
  if (cachedResend) return cachedResend;

  cachedResend = new Resend(requireEnv("RESEND_API_KEY"));

  return cachedResend;
}

/* ================================
   EMAIL QUEUE (RATE LIMIT SAFE)
   Resend limit: 2 requests/sec
================================ */
const emailQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 2,
});

/* ================================
   FROM ADDRESS BUILDER
================================ */
function buildFrom() {
  const mailFrom = process.env.MAIL_FROM;

  if (mailFrom) return mailFrom;

  // prevent sandbox fallback in production
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MAIL_FROM missing. Must use verified domain sender."
    );
  }

  return "Boardroom Booking <onboarding@resend.dev>";
}

/* ================================
   SEND EMAIL
================================ */
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

  if (!toList.length && !ccList.length && !bccList.length) {
    throw new Error("No recipients supplied");
  }

  const payload = {
    from: buildFrom(),
    to: toList.length ? toList : undefined,
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
    /* ===== QUEUED SEND ===== */
    const { data, error } = await emailQueue.add(() =>
      resend.emails.send(payload)
    );

    if (error) {
      console.error("EMAIL FAILED (RESEND)", {
        to: toList,
        subject,
        error,
      });

      return { ok: false, error: error.message };
    }

    console.log("EMAIL SENT (RESEND)", {
      to: toList,
      subject,
      messageId: data?.id,
    });

    return { ok: true, providerMessageId: data?.id };
  } catch (err) {
    console.error("EMAIL FAILED (RESEND)", err);

    return {
      ok: false,
      error: err?.message || "Email send failed",
    };
  }
}

module.exports = { sendEmail };