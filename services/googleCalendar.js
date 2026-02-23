const { google } = require("googleapis");
const { CONST } = require("../config/constants");

/* ======================================================
   OAuth Helpers
====================================================== */

function getOAuthClientNoCredentials() {
  return new google.auth.OAuth2(
    CONST.GOOGLE.CLIENT_ID,
    CONST.GOOGLE.CLIENT_SECRET,
    CONST.GOOGLE.REDIRECT_URI
  );
}

function getOAuthClient() {
  const oAuth2Client = getOAuthClientNoCredentials();

  // This is what your calendar calls use in production.
  // Must be valid, otherwise you'll get invalid_grant.
  oAuth2Client.setCredentials({
    refresh_token: CONST.GOOGLE.REFRESH_TOKEN,
  });

  return oAuth2Client;
}

function getCalendarApi() {
  return google.calendar({
    version: "v3",
    auth: getOAuthClient(),
  });
}

/* ======================================================
   Generate Google Auth URL (Connect)
   IMPORTANT: prompt=consent forces refresh token issuance
====================================================== */

function getGoogleAuthUrl() {
  const oAuth2Client = getOAuthClientNoCredentials();

  // Use the least-privileged scope that supports your actions.
  // If you only need events, events scope is enough.
  const scopes = CONST.GOOGLE.SCOPES?.length
    ? CONST.GOOGLE.SCOPES
    : ["https://www.googleapis.com/auth/calendar.events"];

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // 🔥 forces refresh token
    scope: scopes,
    include_granted_scopes: true,
  });

  return url;
}

/* ======================================================
   Exchange OAuth code → tokens (Callback)
====================================================== */

async function exchangeCodeForTokens(code) {
  try {
    const oAuth2Client = getOAuthClientNoCredentials();
    const { tokens } = await oAuth2Client.getToken(code);

    // tokens may include: access_token, refresh_token, scope, expiry_date
    return tokens;
  } catch (e) {
    console.error("[Google:exchangeCodeForTokens] ERROR", {
      status: e?.response?.status,
      data: e?.response?.data,
      message: e?.message,
    });
    throw e;
  }
}

/* ======================================================
   Error normalization
====================================================== */

function normalizeGoogleAuthError(e) {
  const msg = String(e?.message || "");
  const dataMsg = String(
    e?.response?.data?.error?.message ||
      e?.response?.data?.error ||
      e?.response?.data?.error_description ||
      ""
  );

  const combined = `${msg} ${dataMsg}`.toLowerCase();

  if (combined.includes("invalid_grant")) {
    const err = new Error(
      "Google Calendar authorization expired (invalid_grant). Reconnect Google and update GOOGLE_REFRESH_TOKEN."
    );
    err.code = "GOOGLE_AUTH_INVALID";
    err.status = 401;
    throw err;
  }

  if (combined.includes("redirect_uri_mismatch")) {
    const err = new Error(
      "Google OAuth redirect_uri_mismatch. Ensure GOOGLE_REDIRECT_URI exactly matches an Authorized redirect URI in Google Cloud Console."
    );
    err.code = "GOOGLE_REDIRECT_MISMATCH";
    err.status = 400;
    throw err;
  }

  if (combined.includes("not found")) {
    const err = new Error(
      "Calendar not found. Check GOOGLE_CALENDAR_ID (or set it to 'primary') or share the calendar with this account."
    );
    err.code = "GOOGLE_CALENDAR_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  throw e;
}

/* ======================================================
   LIST EVENTS
====================================================== */

async function listEvents(timeMinISO, timeMaxISO) {
  try {
    const calendar = getCalendarApi();

    const res = await calendar.events.list({
      calendarId: CONST.GOOGLE.CALENDAR_ID,
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      singleEvents: true,
      orderBy: "startTime",
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
          e.hangoutLink ||
          (e.conferenceData && e.conferenceData.entryPoints?.[0]?.uri) ||
          null,
      }));
  } catch (e) {
    console.error("[Google:listEvents] ERROR", {
      status: e?.response?.status,
      data: e?.response?.data,
      message: e?.message,
    });

    normalizeGoogleAuthError(e);
    throw e;
  }
}

/* ======================================================
   CREATE EVENT
====================================================== */

async function createEvent({ title, startAtISO, endAtISO, meetingLink }) {
  try {
    const calendar = getCalendarApi();

    const res = await calendar.events.insert({
      calendarId: CONST.GOOGLE.CALENDAR_ID,
      requestBody: {
        summary: title,
        start: { dateTime: startAtISO },
        end: { dateTime: endAtISO },
        description: meetingLink ? `Meeting Link: ${meetingLink}` : undefined,
      },
    });

    return res.data.id;
  } catch (e) {
    console.error("[Google:createEvent] ERROR", e?.response?.data || e?.message);
    normalizeGoogleAuthError(e);
    throw e;
  }
}

/* ======================================================
   DELETE EVENT
====================================================== */

async function deleteEvent(googleEventId) {
  try {
    const calendar = getCalendarApi();

    await calendar.events.delete({
      calendarId: CONST.GOOGLE.CALENDAR_ID,
      eventId: googleEventId,
    });
  } catch (e) {
    console.error("[Google:deleteEvent] ERROR", e?.response?.data || e?.message);
    normalizeGoogleAuthError(e);
    throw e;
  }
}

module.exports = {
  listEvents,
  createEvent,
  deleteEvent,

  //  NEW exports for refresh-token generation
  getGoogleAuthUrl,
  exchangeCodeForTokens,
};
