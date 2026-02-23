const EAT_TZ = "Africa/Nairobi";

function formatWhen(date) {
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
  } catch (e) {
    return new Date(date).toLocaleString("en-KE", { hour12: true });
  }
}

function bookingTitle(booking) {
  return booking.meetingTitle
    ? `${booking.teamName} — ${booking.meetingTitle}`
    : booking.teamName;
}

function wrapEmailHtml({ title, preheader, bodyHtml }) {
  const appName = process.env.APP_NAME || "Boardroom Booking";

  return `
  <div style="background:#f6f7f9;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ee;">
      <div style="padding:18px 20px;border-bottom:1px solid #eef0f4;">
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#6b7280;">${appName}</div>
        <div style="font-family:Arial,sans-serif;font-size:18px;color:#111827;font-weight:700;margin-top:6px;">
          ${title}
        </div>
      </div>

      <div style="display:none;max-height:0;overflow:hidden;color:transparent;">
        ${preheader || ""}
      </div>

      <div style="padding:20px;font-family:Arial,sans-serif;line-height:1.6;color:#111827;font-size:14px;">
        ${bodyHtml}
      </div>

      <div style="padding:14px 20px;border-top:1px solid #eef0f4;background:#fafbfc;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;">
        This is an automated email from ${appName}.
      </div>
    </div>
  </div>
  `;
}

/**
 * Booking confirmation (compatible with your existing code)
 */
function buildBookingSubject(booking) {
  const title = bookingTitle(booking);
  return `Boardroom booking confirmed: ${title}`;
}

function buildBookingEmailHtml({ user, recipientName, booking }) {
  const name = recipientName || user?.name || "there";
  const title = bookingTitle(booking);

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

function buildBookingEmailText({ user, recipientName, booking }) {
  const name = recipientName || user?.name || "there";
  const title = bookingTitle(booking);

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

/**
 * Reminder email builders (NEW)
 * We will use ENDING_20 (20 mins before exit).
 */
function buildReminderEmailSubject({ booking, type }) {
  const title = bookingTitle(booking);
  if (type === "ENDING_20") return `Reminder: ${title} ends in 20 minutes`;
  return `Reminder: ${title}`;
}

function buildReminderEmailHtml({ user, recipientName, booking, type }) {
  const name = recipientName || user?.name || "there";
  const title = bookingTitle(booking);

  const intro =
    type === "ENDING_20"
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

function buildReminderEmailText({ user, recipientName, booking, type }) {
  const name = recipientName || user?.name || "there";
  const title = bookingTitle(booking);

  const intro =
    type === "ENDING_20"
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

function buildReminderSms({ booking, type }) {
  const title = bookingTitle(booking);
  if (type === "ENDING_20") return `Reminder: "${title}" ends in 20 minutes.`;
  return `Reminder: "${title}".`;
}

module.exports = {
  buildBookingSubject,
  buildBookingEmailHtml,
  buildBookingEmailText,
  buildReminderSms,
  buildReminderEmailSubject,
  buildReminderEmailHtml,
  buildReminderEmailText,
};
