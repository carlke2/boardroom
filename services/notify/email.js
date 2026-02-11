const nodemailer = require("nodemailer");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
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
    auth: { user, pass }
  });

  return cachedTransporter;
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html
    });

    console.log("✅ EMAIL SENT", {
      to,
      subject,
      messageId: info.messageId,
      response: info.response
    });

    return { ok: true, messageId: info.messageId, response: info.response };
  } catch (err) {
    console.error("❌ EMAIL FAILED", {
      to,
      subject,
      error: err.message
    });
    throw err;
  }
}

module.exports = { sendEmail };
