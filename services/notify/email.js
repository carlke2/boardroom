const nodemailer = require("nodemailer");

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
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);

  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },

    // production hardening (safe defaults)
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 3),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),

    connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT_MS || 20_000),
    greetingTimeout: Number(process.env.SMTP_GREET_TIMEOUT_MS || 20_000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 30_000),
  });

  return cachedTransporter;
}

function buildFrom() {
  const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || process.env.APP_NAME || "Boardroom Booking";
  // Nodemailer supports: "Name <email@domain.com>"
  return `${fromName} <${fromEmail}>`;
}

/**
 * sendEmail
 * - supports to/cc/bcc as string | string[]
 * - supports attachments (for ICS later)
 */
async function sendEmail({ to, cc, bcc, subject, html, text, attachments, replyTo }) {
  const transporter = getTransporter();

  const toList = normalizeEmailList(to);
  const ccList = normalizeEmailList(cc);
  const bccList = normalizeEmailList(bcc);

  if (!toList.length && !ccList.length && !bccList.length) {
    throw new Error("sendEmail: missing recipients (to/cc/bcc)");
  }

  try {
    const info = await transporter.sendMail({
      from: buildFrom(),
      to: toList.length ? toList : undefined,
      cc: ccList.length ? ccList : undefined,
      bcc: bccList.length ? bccList : undefined,
      replyTo: replyTo || undefined,
      subject,
      text,
      html,
      attachments: Array.isArray(attachments) ? attachments : undefined,
    });

    console.log("EMAIL SENT", {
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      messageId: info.messageId,
      response: info.response,
    });

    return { ok: true, providerMessageId: info.messageId, response: info.response };
  } catch (err) {
    console.error("EMAIL FAILED", {
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
