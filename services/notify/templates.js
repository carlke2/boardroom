function formatWhen(date) {
  // Keep it simple and readable (timezone rendering can be improved later)
  return new Date(date).toLocaleString("en-KE", { hour12: true });
}

function buildBookingSubject(booking) {
  const title = booking.meetingTitle ? `${booking.teamName} — ${booking.meetingTitle}` : booking.teamName;
  return `Boardroom booking confirmed: ${title}`;
}

function buildBookingEmailHtml({ user, booking }) {
  const title = booking.meetingTitle ? `${booking.teamName} — ${booking.meetingTitle}` : booking.teamName;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6">
      <h2>Booking confirmed</h2>
      <p>Hello ${user.name},</p>
      <p>Your boardroom booking has been confirmed.</p>
      <ul>
        <li><b>Meeting:</b> ${title}</li>
        <li><b>Start:</b> ${formatWhen(booking.startAt)}</li>
        <li><b>End:</b> ${formatWhen(booking.endAt)}</li>
        <li><b>Duration:</b> ${booking.durationMinutes} minutes</li>
      </ul>
      ${booking.meetingLink ? `<p><b>Meeting link:</b> ${booking.meetingLink}</p>` : ""}
      <p>Thanks.</p>
    </div>
  `;
}

function buildBookingEmailText({ user, booking }) {
  const title = booking.meetingTitle ? `${booking.teamName} — ${booking.meetingTitle}` : booking.teamName;

  return [
    `Hello ${user.name},`,
    ``,
    `Your boardroom booking has been confirmed.`,
    `Meeting: ${title}`,
    `Start: ${formatWhen(booking.startAt)}`,
    `End: ${formatWhen(booking.endAt)}`,
    `Duration: ${booking.durationMinutes} minutes`,
    booking.meetingLink ? `Meeting link: ${booking.meetingLink}` : ``,
  ].filter(Boolean).join("\n");
}

function buildReminderSms({ booking, type }) {
  const title = booking.meetingTitle ? `${booking.teamName} — ${booking.meetingTitle}` : booking.teamName;

  if (type === "STARTS_20") return `Reminder: "${title}" starts in 20 minutes.`;
  if (type === "JOIN_NOW") return `Now: "${title}" is starting.`;
  if (type === "ENDING_10") return `Heads up: "${title}" ends in 10 minutes.`;

  return `Reminder: "${title}".`;
}

module.exports = {
  buildBookingSubject,
  buildBookingEmailHtml,
  buildBookingEmailText,
  buildReminderSms
};
