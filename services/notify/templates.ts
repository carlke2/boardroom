const EAT_TZ = "Africa/Nairobi";

export interface MailBooking {
  teamName: string;
  meetingTitle?: string;
  startAt: Date | string;
  endAt: Date | string;
  durationMinutes?: number;
  meetingLink?: string | null;
}

function formatWhen(date: Date | string): string {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: EAT_TZ,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleString("en-KE", { hour12: true });
  }
}

function bookingTitle(booking: MailBooking): string {
  return booking.meetingTitle
    ? `${booking.teamName} — ${booking.meetingTitle}`
    : booking.teamName;
}

function wrapEmailHtml(input: { title: string; preheader?: string; bodyHtml: string }): string {
  const appName = process.env.APP_NAME || "Boardroom Booking";

  return `
  <div style="background:#f6f7f9;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ee;">
      <div style="padding:18px 20px;border-bottom:1px solid #eef0f4;">
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#6b7280;">${appName}</div>
        <div style="font-family:Arial,sans-serif;font-size:18px;color:#111827;font-weight:700;margin-top:6px;">
          ${input.title}
        </div>
      </div>

      <div style="display:none;max-height:0;overflow:hidden;color:transparent;">
        ${input.preheader || ""}
      </div>

      <div style="padding:20px;font-family:Arial,sans-serif;line-height:1.6;color:#111827;font-size:14px;">
        ${input.bodyHtml}
      </div>

      <div style="padding:14px 20px;border-top:1px solid #eef0f4;background:#fafbfc;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;">
        This is an automated email from ${appName}.
      </div>
    </div>
  </div>
  `;
}

export function buildBookingSubject(booking: MailBooking): string {
  return `Boardroom booking confirmed: ${bookingTitle(booking)}`;
}

export function buildBookingEmailHtml(input: {
  user?: { name?: string } | null;
  recipientName?: string | null;
  booking: MailBooking;
}): string {
  const name = input.recipientName || input.user?.name || "there";
  const title = bookingTitle(input.booking);
  const booking = input.booking;

  const body = `
    <p>Hello ${name},</p>
    <p>Your boardroom booking has been confirmed.</p>
    <ul style="padding-left:18px;margin:12px 0;">
      <li><b>Meeting:</b> ${title}</li>
      <li><b>Start:</b> ${formatWhen(booking.startAt)}</li>
      <li><b>End:</b> ${formatWhen(booking.endAt)}</li>
      <li><b>Duration:</b> ${booking.durationMinutes} minutes</li>
    </ul>
    ${booking.meetingLink ? `<p><b>Meeting link:</b> ${booking.meetingLink}</p>` : ""}
    <p>Thanks.</p>
  `;

  return wrapEmailHtml({
    title: "Booking confirmed",
    preheader: `Confirmed: ${title} • ${formatWhen(booking.startAt)}`,
    bodyHtml: body,
  });
}

export function buildBookingEmailText(input: {
  user?: { name?: string } | null;
  recipientName?: string | null;
  booking: MailBooking;
}): string {
  const name = input.recipientName || input.user?.name || "there";
  const title = bookingTitle(input.booking);
  const booking = input.booking;

  return [
    `Hello ${name},`,
    ``,
    `Your boardroom booking has been confirmed.`,
    `Meeting: ${title}`,
    `Start: ${formatWhen(booking.startAt)}`,
    `End: ${formatWhen(booking.endAt)}`,
    `Duration: ${booking.durationMinutes} minutes`,
    booking.meetingLink ? `Meeting link: ${booking.meetingLink}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReminderEmailSubject(input: { booking: MailBooking; type?: string }): string {
  const title = bookingTitle(input.booking);
  if (input.type === "ENDING_20") return `Reminder: ${title} ends in 20 minutes`;
  return `Reminder: ${title}`;
}

export function buildReminderEmailHtml(input: {
  user?: { name?: string } | null;
  recipientName?: string | null;
  booking: MailBooking;
  type?: string;
}): string {
  const name = input.recipientName || input.user?.name || "there";
  const title = bookingTitle(input.booking);
  const booking = input.booking;

  const intro =
    input.type === "ENDING_20"
      ? `<p>Heads up: your boardroom booking ends in <b>20 minutes</b>.</p>`
      : `<p>This is a reminder for your meeting.</p>`;

  const body = `
    <p>Hello ${name},</p>
    ${intro}
    <ul style="padding-left:18px;margin:12px 0;">
      <li><b>Meeting:</b> ${title}</li>
      <li><b>Start:</b> ${formatWhen(booking.startAt)}</li>
      <li><b>End:</b> ${formatWhen(booking.endAt)}</li>
    </ul>
    ${booking.meetingLink ? `<p><b>Join link:</b> ${booking.meetingLink}</p>` : ""}
    <p>Thanks.</p>
  `;

  return wrapEmailHtml({
    title: "Boardroom reminder",
    preheader: `Reminder: ${title} • ends ${formatWhen(booking.endAt)}`,
    bodyHtml: body,
  });
}

export function buildReminderEmailText(input: {
  user?: { name?: string } | null;
  recipientName?: string | null;
  booking: MailBooking;
  type?: string;
}): string {
  const name = input.recipientName || input.user?.name || "there";
  const title = bookingTitle(input.booking);
  const booking = input.booking;

  const intro =
    input.type === "ENDING_20"
      ? `Heads up: your boardroom booking ends in 20 minutes.`
      : `Reminder: your meeting is coming up.`;

  return [
    `Hello ${name},`,
    ``,
    intro,
    `Meeting: ${title}`,
    `Start: ${formatWhen(booking.startAt)}`,
    `End: ${formatWhen(booking.endAt)}`,
    booking.meetingLink ? `Join link: ${booking.meetingLink}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReminderSms(input: { booking: MailBooking; type?: string }): string {
  const title = bookingTitle(input.booking);
  if (input.type === "ENDING_20") return `Reminder: "${title}" ends in 20 minutes.`;
  return `Reminder: "${title}".`;
}
