export const CONST = {
  TIMEZONE: process.env.TIMEZONE || "Africa/Nairobi",
  BUFFER_MINUTES: parseInt(process.env.BUFFER_MINUTES || "5", 10),
  WORK_START: process.env.WORK_START || "08:00",
  WORK_END: process.env.WORK_END || "18:00",
  SLOT_MINUTES: parseInt(process.env.SLOT_MINUTES || "30", 10),
  COMPANY_DOMAIN: process.env.COMPANY_DOMAIN || "",
};
