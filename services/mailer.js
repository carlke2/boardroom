// services/mailer.js
const nodemailer = require("nodemailer");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: requireEnv("SMTP_USER"),
      pass: requireEnv("SMTP_PASS"), // Gmail App Password
    },
  });
}

async function sendMail({ to, subject, text }) {
  const transporter = createTransport();
  const from = process.env.MAIL_FROM || requireEnv("SMTP_USER");

  return transporter.sendMail({ from, to, subject, text });
}

module.exports = { sendMail };
