import { getEnv } from "./env.js";

/** Tunables from the single env module. */
export const CONST = {
  get TIMEZONE() {
    return getEnv().TIMEZONE;
  },
  get BUFFER_MINUTES() {
    return getEnv().BUFFER_MINUTES;
  },
  get WORK_START() {
    return getEnv().WORK_START;
  },
  get WORK_END() {
    return getEnv().WORK_END;
  },
  get SLOT_MINUTES() {
    return getEnv().SLOT_MINUTES;
  },
  get COMPANY_DOMAIN() {
    return getEnv().COMPANY_DOMAIN;
  },
};
