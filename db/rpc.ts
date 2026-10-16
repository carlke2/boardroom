import type { QueryResultRow } from "pg";
import { mapDbError } from "../utils/httpError.js";
import { withUser } from "./postgres.js";

export type UserQuery = <T extends QueryResultRow>(
  claims: Record<string, unknown>,
  text: string,
  values?: unknown[]
) => Promise<T[]>;

export const userQuery = (async (claims, text, values = []) => {
  try {
    return await withUser(claims, async (client) => {
      const result = await client.query(text, values);
      return result.rows;
    });
  } catch (error) {
    throw mapDbError(error);
  }
}) as UserQuery;
