function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing in .env`);
  return v;
}

export interface GoogleConfig {
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  REDIRECT_URI: string;
  REFRESH_TOKEN: string;
  CALENDAR_ID: string;
  SCOPES?: string[];
}

const GOOGLE: GoogleConfig = {
  CLIENT_ID: mustEnv("GOOGLE_CLIENT_ID"),
  CLIENT_SECRET: mustEnv("GOOGLE_CLIENT_SECRET"),
  REDIRECT_URI: mustEnv("GOOGLE_REDIRECT_URI"),
  REFRESH_TOKEN: mustEnv("GOOGLE_REFRESH_TOKEN"),
  CALENDAR_ID: mustEnv("GOOGLE_CALENDAR_ID"),
};

export const CONST = {
  TIMEZONE: process.env.TIMEZONE || "Africa/Nairobi",
  BUFFER_MINUTES: parseInt(process.env.BUFFER_MINUTES || "5", 10),
  WORK_START: process.env.WORK_START || "08:00",
  WORK_END: process.env.WORK_END || "18:00",
  SLOT_MINUTES: parseInt(process.env.SLOT_MINUTES || "30", 10),
  COMPANY_DOMAIN: process.env.COMPANY_DOMAIN || "",
  GOOGLE,
};
