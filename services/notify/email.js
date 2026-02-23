const { Resend } = require("resend");

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

// Resend client (cached)
let cachedResend = null;
function getResend() {
  if (cachedResend) return cachedResend;
  cachedResend = new Resend(requireEnv("RESEND_API_KEY"));
  return cachedResend;
}

/**
 * buildFrom
 * Priority:
 * 1) MAIL_FROM (recommended) -> "Name <email@domain.com>"
 * 2) MAIL_FROM_EMAIL/MAIL_FROM_NAME (compat)
 * 3) fallback to onboarding@resend.dev (safe default)
 */
function buildFrom() {
  const mailFrom = process.env.MAIL_FROM;
  if (mailFrom) return mailFrom;

  const fromEmail =
    process.env.MAIL_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "onboarding@resend.dev";

  const fromName =
    process.env.MAIL_FROM_NAME ||
    process.env.APP_NAME ||
    "Boardroom Booking";

  return `${fromName} <${fromEmail}>`;
}

/**
 * sendEmail (Resend)
 * - supports to/cc/bcc as string | string[]
 * - supports attachments (base64) e.g. ICS later
 * NOTE: Resend attachments require { filename, content, contentType }
 * where content is base64 (no data: prefix).
 */
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
    throw new Error("sendEmail: missing recipients (to/cc/bcc)");
  }

  // Resend supports either html or text; we’ll pass both when available.
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
          filename: a.filename || a.name || "attachment",
          content: a.content, // MUST be base64 string
          contentType: a.contentType || a.content_type || a.mimetype,
        }))
      : undefined,
  };

  try {
    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error("EMAIL FAILED (RESEND)", {
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        error,
      });
      return { ok: false, error: error.message || "Email send failed" };
    }

    console.log("EMAIL SENT (RESEND)", {
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      providerMessageId: data?.id,
    });

    return { ok: true, providerMessageId: data?.id };
  } catch (err) {
    console.error("EMAIL FAILED (RESEND)", {
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      error: err?.message || err,
    });
    return { ok: false, error: err?.message || "Email send failed" };
  }
}

module.exports = { sendEmail };