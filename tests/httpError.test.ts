import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, mapDbError } from "../utils/httpError.js";

test("database errors map to the API codes", () => {
  assert.equal((mapDbError({ code: "42501", message: "not allowed" }) as HttpError).apiCode, "forbidden");
  const missing = mapDbError({ code: "P0001", message: "room not found" }) as HttpError;
  assert.equal(missing.status, 404);
  assert.equal(missing.apiCode, "not_found");
  const invalid = mapDbError({ code: "P0001", message: "invalid priority" }) as HttpError;
  assert.equal(invalid.status, 422);
  assert.equal(invalid.apiCode, "validation");
  const clash = mapDbError({
    code: "23P01",
    message: "room is already booked",
    detail: JSON.stringify({ id: "b1", roomId: "r1", startAt: "2026-10-20T07:00:00.000Z", endAt: "2026-10-20T08:00:00.000Z", status: "CONFIRMED" }),
  }) as HttpError;
  assert.equal(clash.status, 409);
  assert.equal(clash.apiCode, "conflict");
  assert.equal((clash.details.booking as { id: string }).id, "b1");
});
