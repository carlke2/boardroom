import { google } from "googleapis";
import { CONST } from "../config/constants.js";
import { asGoogleApiError } from "../utils/errors.js";

export interface ListedEvent {
  googleEventId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  meetingLink: string | null;
}

function getOAuthClientNoCredentials() {
  return new google.auth.OAuth2(
    CONST.GOOGLE.CLIENT_ID,
    CONST.GOOGLE.CLIENT_SECRET,
    CONST.GOOGLE.REDIRECT_URI
  );
}

function getOAuthClient() {
  const oAuth2Client = getOAuthClientNoCredentials();
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

export function getGoogleAuthUrl(): string {
  const oAuth2Client = getOAuthClientNoCredentials();
  const scopes = CONST.GOOGLE.SCOPES?.length
    ? CONST.GOOGLE.SCOPES
    : ["https://www.googleapis.com/auth/calendar.events"];

  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(code: string) {
  try {
    const oAuth2Client = getOAuthClientNoCredentials();
    const { tokens } = await oAuth2Client.getToken(code);
    return tokens;
  } catch (e) {
    const err = asGoogleApiError(e);
    console.error("[Google:exchangeCodeForTokens] ERROR", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    throw e;
  }
}

function normalizeGoogleAuthError(e: unknown): never {
  const err = asGoogleApiError(e);
  const msg = String(err.message || "");
  const data = err.response?.data;
  const nested =
    data && typeof data.error === "object" && data.error
      ? data.error.message
      : undefined;
  const dataMsg = String(
    nested ||
      (typeof data?.error === "string" ? data.error : "") ||
      data?.error_description ||
      ""
  );

  const combined = `${msg} ${dataMsg}`.toLowerCase();

  if (combined.includes("invalid_grant")) {
    const wrapped = new Error(
      "Google Calendar authorization expired (invalid_grant). Reconnect Google and update GOOGLE_REFRESH_TOKEN."
    ) as Error & { code?: string; status?: number };
    wrapped.code = "GOOGLE_AUTH_INVALID";
    wrapped.status = 401;
    throw wrapped;
  }

  if (combined.includes("redirect_uri_mismatch")) {
    const wrapped = new Error(
      "Google OAuth redirect_uri_mismatch. Ensure GOOGLE_REDIRECT_URI exactly matches an Authorized redirect URI in Google Cloud Console."
    ) as Error & { code?: string; status?: number };
    wrapped.code = "GOOGLE_REDIRECT_MISMATCH";
    wrapped.status = 400;
    throw wrapped;
  }

  if (combined.includes("not found")) {
    const wrapped = new Error(
      "Calendar not found. Check GOOGLE_CALENDAR_ID (or set it to 'primary') or share the calendar with this account."
    ) as Error & { code?: string; status?: number };
    wrapped.code = "GOOGLE_CALENDAR_NOT_FOUND";
    wrapped.status = 404;
    throw wrapped;
  }

  throw e instanceof Error ? e : new Error(String(e));
}

export async function listEvents(timeMinISO: string, timeMaxISO: string): Promise<ListedEvent[]> {
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
      .filter((e) => e.status !== "cancelled" && e.id && e.start && e.end)
      .map((e) => ({
        googleEventId: e.id as string,
        title: e.summary || "(No title)",
        startAt: new Date(e.start?.dateTime || e.start?.date || ""),
        endAt: new Date(e.end?.dateTime || e.end?.date || ""),
        meetingLink:
          e.hangoutLink ||
          e.conferenceData?.entryPoints?.[0]?.uri ||
          null,
      }));
  } catch (e) {
    const err = asGoogleApiError(e);
    console.error("[Google:listEvents] ERROR", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    normalizeGoogleAuthError(e);
  }
}

export async function createEvent(input: {
  title: string;
  startAtISO: string;
  endAtISO: string;
  meetingLink: string | null;
}): Promise<string> {
  try {
    const calendar = getCalendarApi();
    const res = await calendar.events.insert({
      calendarId: CONST.GOOGLE.CALENDAR_ID,
      requestBody: {
        summary: input.title,
        start: { dateTime: input.startAtISO },
        end: { dateTime: input.endAtISO },
        description: input.meetingLink ? `Meeting Link: ${input.meetingLink}` : undefined,
      },
    });

    if (!res.data.id) throw new Error("Google Calendar did not return an event id");
    return res.data.id;
  } catch (e) {
    const err = asGoogleApiError(e);
    console.error("[Google:createEvent] ERROR", err.response?.data || err.message);
    normalizeGoogleAuthError(e);
  }
}

export async function deleteEvent(googleEventId: string): Promise<void> {
  try {
    const calendar = getCalendarApi();
    await calendar.events.delete({
      calendarId: CONST.GOOGLE.CALENDAR_ID,
      eventId: googleEventId,
    });
  } catch (e) {
    const err = asGoogleApiError(e);
    console.error("[Google:deleteEvent] ERROR", err.response?.data || err.message);
    normalizeGoogleAuthError(e);
  }
}
