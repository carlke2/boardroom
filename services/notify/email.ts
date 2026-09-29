import { Resend, type CreateEmailOptions } from "resend";
import PQueue from "p-queue";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function normalizeEmailList(value: unknown): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .flatMap((x) => String(x).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

let cachedResend: Resend | null = null;

function getResend(): Resend {
  if (cachedResend) return cachedResend;
  cachedResend = new Resend(requireEnv("RESEND_API_KEY"));
  return cachedResend;
}

const emailQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 1,
});

function buildFrom(): string {
  const from = process.env.MAIL_FROM;
  if (!from) {
    throw new Error("MAIL_FROM missing. Example: Boardroom <no-reply@bms.millenium.co.ke>");
  }
  return from;
}

function getSecretaryEmail(): string | null {
  return process.env.SECRETARY_EMAIL || null;
}

function statusCodeOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

export interface EmailAttachment {
  filename?: string;
  content: string | Buffer;
  contentType?: string;
  mimetype?: string;
}

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: unknown };

export async function sendEmail(input: {
  to: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
}): Promise<SendEmailResult> {
  const resend = getResend();

  const toList = normalizeEmailList(input.to);
  const ccList = normalizeEmailList(input.cc);
  const bccList = normalizeEmailList(input.bcc);

  if (!toList.length) {
    throw new Error("No recipient provided");
  }

  const secretary = getSecretaryEmail();
  if (secretary && !ccList.includes(secretary)) {
    ccList.push(secretary);
  }

  const replyTo = input.replyTo || process.env.MAIL_REPLY_TO;
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.map((a) => ({
        filename: a.filename || "attachment",
        content: a.content,
        contentType: a.contentType || a.mimetype,
      }))
    : [];

  const shared = {
    from: buildFrom(),
    to: toList,
    subject: input.subject,
    ...(ccList.length ? { cc: ccList } : {}),
    ...(bccList.length ? { bcc: bccList } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length ? { attachments } : {}),
  };

  let payload: CreateEmailOptions;
  if (input.html && input.text) {
    payload = { ...shared, html: input.html, text: input.text };
  } else if (input.html) {
    payload = { ...shared, html: input.html };
  } else {
    payload = { ...shared, text: input.text || "" };
  }

  try {
    const { data, error } = await emailQueue.add(async () => {
      try {
        return await resend.emails.send(payload);
      } catch (err) {
        if (statusCodeOf(err) === 429) {
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
    const message = err instanceof Error ? err.message : String(err);
    console.error("EMAIL FAILED", err);
    return { ok: false, error: message };
  }
}
