const { google } = require("googleapis");
const { CONST } = require("../config/constants");

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    CONST.GOOGLE.CLIENT_ID,
    CONST.GOOGLE.CLIENT_SECRET,
    CONST.GOOGLE.REDIRECT_URI
  );
  oAuth2Client.setCredentials({ refresh_token: CONST.GOOGLE.REFRESH_TOKEN });
  return oAuth2Client;
}

function getCalendarApi() {
  const auth = getOAuthClient();
  return google.calendar({ version: "v3", auth });
}

async function listEvents(timeMinISO, timeMaxISO) {
  const calendar = getCalendarApi();
  const res = await calendar.events.list({
    calendarId: CONST.GOOGLE.CALENDAR_ID,
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: true,
    orderBy: "startTime"
  });

  const items = res.data.items || [];
  return items
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      googleEventId: e.id,
      title: e.summary || "(No title)",
      startAt: new Date(e.start.dateTime || e.start.date),
      endAt: new Date(e.end.dateTime || e.end.date),
      meetingLink:
        e.hangoutLink || (e.conferenceData && e.conferenceData.entryPoints?.[0]?.uri) || null
    }));
}

async function createEvent({ title, startAtISO, endAtISO, meetingLink }) {
  const calendar = getCalendarApi();
  const res = await calendar.events.insert({
    calendarId: CONST.GOOGLE.CALENDAR_ID,
    requestBody: {
      summary: title,
      start: { dateTime: startAtISO },
      end: { dateTime: endAtISO },
      description: meetingLink ? `Meeting Link: ${meetingLink}` : undefined
    }
  });
  return res.data.id;
}

async function deleteEvent(googleEventId) {
  const calendar = getCalendarApi();
  await calendar.events.delete({
    calendarId: CONST.GOOGLE.CALENDAR_ID,
    eventId: googleEventId
  });
}

module.exports = { listEvents, createEvent, deleteEvent };
