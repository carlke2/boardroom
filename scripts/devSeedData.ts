import type { Env } from "../config/env.js";
import {
  EXTRA_REQUESTER_EMAIL,
  SEED_TAG,
  createDevAuthUser,
  devAccounts,
  findAuthUserByEmail,
  newDevPassword,
  prepareDevSeed,
  redact,
  updateDevAuthUser,
  upsertDevProfile,
  withDevService,
  type DevRole,
} from "./devSeed.js";

const ROOM_NAMES = [`${SEED_TAG} room 1`, `${SEED_TAG} room 2`] as const;

interface TicketSeed {
  number: string;
  subject: string;
  status: string;
  priority: string;
  requester: "USER" | "EXTRA";
  sla: "on_track" | "breached" | "at_risk" | "paused" | "met";
}

const TICKETS: TicketSeed[] = [
  { number: `${SEED_TAG}-1`, subject: "Printer jam", status: "NEW", priority: "LOW", requester: "USER", sla: "on_track" },
  { number: `${SEED_TAG}-2`, subject: "VPN down", status: "OPEN", priority: "HIGH", requester: "USER", sla: "breached" },
  { number: `${SEED_TAG}-3`, subject: "Badge not opening", status: "IN_PROGRESS", priority: "MEDIUM", requester: "EXTRA", sla: "at_risk" },
  { number: `${SEED_TAG}-4`, subject: "Mailbox full", status: "PENDING_CUSTOMER", priority: "URGENT", requester: "EXTRA", sla: "paused" },
  { number: `${SEED_TAG}-5`, subject: "Monitor flicker", status: "RESOLVED", priority: "LOW", requester: "USER", sla: "met" },
];

const COMMENTS = [
  { number: `${SEED_TAG}-2`, body: `${SEED_TAG} internal note 1` },
  { number: `${SEED_TAG}-3`, body: `${SEED_TAG} internal note 2` },
];

function zoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return asUtc - date.getTime();
}

function at(timeZone: string, dayOffset: number, hour: number): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const guess = new Date(Date.UTC(pick("year"), pick("month") - 1, pick("day") + dayOffset, hour, 0, 0));
  return new Date(guess.getTime() - zoneOffsetMs(timeZone, guess));
}

function slaColumns(kind: TicketSeed["sla"]): {
  responseDue: Date;
  resolutionDue: Date;
  breachedResponse: Date | null;
  breachedResolution: Date | null;
  paused: Date | null;
  resolved: Date | null;
} {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  if (kind === "breached") {
    return {
      responseDue: new Date(now - 2 * hour),
      resolutionDue: new Date(now - hour),
      breachedResponse: new Date(now - hour),
      breachedResolution: new Date(now - 30 * 60 * 1000),
      paused: null,
      resolved: null,
    };
  }
  if (kind === "at_risk") {
    return {
      responseDue: new Date(now + 20 * 60 * 1000),
      resolutionDue: new Date(now + 25 * 60 * 1000),
      breachedResponse: null,
      breachedResolution: null,
      paused: null,
      resolved: null,
    };
  }
  if (kind === "paused") {
    return {
      responseDue: new Date(now + 4 * hour),
      resolutionDue: new Date(now + 8 * hour),
      breachedResponse: null,
      breachedResolution: null,
      paused: new Date(now - 15 * 60 * 1000),
      resolved: null,
    };
  }
  if (kind === "met") {
    return {
      responseDue: new Date(now - 3 * hour),
      resolutionDue: new Date(now + 4 * hour),
      breachedResponse: null,
      breachedResolution: null,
      paused: null,
      resolved: new Date(now - hour),
    };
  }
  return {
    responseDue: new Date(now + 4 * hour),
    resolutionDue: new Date(now + 8 * hour),
    breachedResponse: null,
    breachedResolution: null,
    paused: null,
    resolved: null,
  };
}

async function ensureExtraRequester(env: Env): Promise<{ status: "created" | "already existed"; userId: string }> {
  const existing = await findAuthUserByEmail(env, EXTRA_REQUESTER_EMAIL);
  const role: DevRole = "USER";
  if (!existing) {
    const created = await createDevAuthUser(env, EXTRA_REQUESTER_EMAIL, newDevPassword(), "Dev requester");
    await withDevService((client) => upsertDevProfile(client, created.id, "Dev requester", EXTRA_REQUESTER_EMAIL, role));
    return { status: "created", userId: created.id };
  }
  await updateDevAuthUser(env, existing.id, "Dev requester");
  await withDevService((client) => upsertDevProfile(client, existing.id, "Dev requester", EXTRA_REQUESTER_EMAIL, role));
  return { status: "already existed", userId: existing.id };
}

export async function seedDevData(): Promise<void> {
  const env = await prepareDevSeed();
  const accounts = devAccounts(env);
  const ids = new Map<DevRole, string>();
  for (const account of accounts) {
    const found = await findAuthUserByEmail(env, account.email);
    if (!found) throw new Error(`Dev seed user is missing. Run dev:seed-users first: ${account.role}`);
    ids.set(account.role, found.id);
  }
  const extra = await ensureExtraRequester(env);
  console.log(`${extra.status} role=USER userId=${extra.userId}`);

  const userId = ids.get("USER")!;
  const agentId = ids.get("AGENT")!;
  const requester = (key: TicketSeed["requester"]) => (key === "USER" ? userId : extra.userId);
  const todayStart = at(env.TIMEZONE, 0, 10);
  const todayEnd = at(env.TIMEZONE, 0, 11);
  const laterStart = at(env.TIMEZONE, 1, 10);
  const laterEnd = at(env.TIMEZONE, 1, 11);

  await withDevService(async (client) => {
    await client.query("SELECT set_config('app.ticket_transition', 'on', true)");
    const roomIds: string[] = [];
    for (const [index, name] of ROOM_NAMES.entries()) {
      const before = await client.query("SELECT id FROM public.rooms WHERE name = $1", [name]);
      const saved = await client.query<{ id: string }>(
        `INSERT INTO public.rooms (name, capacity, is_active, location, notes)
         VALUES ($1, $2, true, $3, $3)
         ON CONFLICT (name) DO UPDATE SET is_active = true
         RETURNING id`,
        [name, index === 0 ? 8 : 12, SEED_TAG]
      );
      roomIds.push(saved.rows[0].id);
      console.log(`${before.rowCount ? "already existed" : "created"} room=${name} id=${saved.rows[0].id}`);
    }

    const categoryBefore = await client.query("SELECT id FROM public.ticket_categories WHERE name = $1", [SEED_TAG]);
    const category = await client.query<{ id: string }>(
      `INSERT INTO public.ticket_categories (name, default_priority, active)
       VALUES ($1, 'MEDIUM', true)
       ON CONFLICT (name) DO UPDATE SET active = true
       RETURNING id`,
      [SEED_TAG]
    );
    const categoryId = category.rows[0].id;
    console.log(`${categoryBefore.rowCount ? "already existed" : "created"} category=${SEED_TAG} id=${categoryId}`);

    const ticketIds = new Map<string, string>();
    for (const ticket of TICKETS) {
      const before = await client.query<{ id: string }>("SELECT id FROM public.tickets WHERE number = $1", [ticket.number]);
      const saved = await client.query<{ id: string }>(
        `INSERT INTO public.tickets (number, subject, description, status, priority, category_id, requester_id, channel, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, 'SYSTEM', $8)
         ON CONFLICT (number) DO UPDATE
         SET subject = EXCLUDED.subject,
             status = EXCLUDED.status,
             priority = EXCLUDED.priority,
             category_id = EXCLUDED.category_id,
             requester_id = EXCLUDED.requester_id,
             source_ref = EXCLUDED.source_ref
         RETURNING id`,
        [ticket.number, ticket.subject, SEED_TAG, ticket.status, ticket.priority, categoryId, requester(ticket.requester), SEED_TAG]
      );
      const ticketId = saved.rows[0].id;
      ticketIds.set(ticket.number, ticketId);
      const sla = slaColumns(ticket.sla);
      await client.query(
        `INSERT INTO public.ticket_staff (
           ticket_id, assignee_id, sla_response_due, sla_resolution_due,
           sla_response_breached_at, sla_resolution_breached_at, sla_paused_at, resolved_at
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ticket_id) DO UPDATE
         SET assignee_id = EXCLUDED.assignee_id,
             sla_response_due = EXCLUDED.sla_response_due,
             sla_resolution_due = EXCLUDED.sla_resolution_due,
             sla_response_breached_at = EXCLUDED.sla_response_breached_at,
             sla_resolution_breached_at = EXCLUDED.sla_resolution_breached_at,
             sla_paused_at = EXCLUDED.sla_paused_at,
             resolved_at = EXCLUDED.resolved_at`,
        [ticketId, agentId, sla.responseDue, sla.resolutionDue, sla.breachedResponse, sla.breachedResolution, sla.paused, sla.resolved]
      );
      console.log(`${before.rowCount ? "already existed" : "created"} ticket=${ticket.number} id=${ticketId} status=${ticket.status} priority=${ticket.priority} sla=${ticket.sla}`);
    }

    for (const comment of COMMENTS) {
      const ticketId = ticketIds.get(comment.number)!;
      const before = await client.query(
        "SELECT id FROM public.ticket_comments WHERE ticket_id = $1::uuid AND body = $2",
        [ticketId, comment.body]
      );
      if (before.rowCount) {
        console.log(`already existed comment ticket=${comment.number}`);
        continue;
      }
      const saved = await client.query<{ id: string }>(
        `INSERT INTO public.ticket_comments (ticket_id, author_id, body, is_internal)
         VALUES ($1::uuid, $2::uuid, $3, true)
         RETURNING id`,
        [ticketId, agentId, comment.body]
      );
      console.log(`created comment ticket=${comment.number} id=${saved.rows[0].id}`);
    }

    const bookings = [
      { title: `${SEED_TAG} booking today`, roomId: roomIds[0], start: todayStart, end: todayEnd },
      { title: `${SEED_TAG} booking later`, roomId: roomIds[1], start: laterStart, end: laterEnd },
    ];
    for (const booking of bookings) {
      const before = await client.query<{ id: string }>(
        "SELECT id FROM public.bookings WHERE meeting_title = $1 AND team_name = $2",
        [booking.title, SEED_TAG]
      );
      if (before.rowCount) {
        console.log(`already existed booking=${booking.title} id=${before.rows[0].id}`);
        continue;
      }
      const saved = await client.query<{ id: string }>(
        `INSERT INTO public.bookings (
           user_id, room_id, attendee_count, attendees, team_name, meeting_title,
           duration_minutes, start_at, end_at, status
         )
         VALUES ($1::uuid, $2::uuid, 2, '{}', $3, $4, 60, $5, $6, 'CONFIRMED')
         RETURNING id`,
        [userId, booking.roomId, SEED_TAG, booking.title, booking.start, booking.end]
      );
      console.log(`created booking=${booking.title} id=${saved.rows[0].id}`);
    }

    const notes = [
      { title: `${SEED_TAG}: ticket opened`, userId, ticketId: ticketIds.get(`${SEED_TAG}-1`)!, bookingId: null as string | null },
      { title: `${SEED_TAG}: assigned`, userId: agentId, ticketId: ticketIds.get(`${SEED_TAG}-2`)!, bookingId: null as string | null },
      { title: `${SEED_TAG}: booking today`, userId, ticketId: null as string | null, bookingId: null as string | null },
    ];
    const todayBooking = await client.query<{ id: string }>(
      "SELECT id FROM public.bookings WHERE meeting_title = $1 AND team_name = $2",
      [`${SEED_TAG} booking today`, SEED_TAG]
    );
    notes[2].bookingId = todayBooking.rows[0]?.id ?? null;
    for (const note of notes) {
      const before = await client.query<{ id: string }>(
        "SELECT id FROM public.notifications WHERE user_id = $1::uuid AND title = $2 AND event_type = $3",
        [note.userId, note.title, SEED_TAG]
      );
      if (before.rowCount) {
        console.log(`already existed notification=${note.title} id=${before.rows[0].id}`);
        continue;
      }
      const saved = await client.query<{ id: string }>(
        `INSERT INTO public.notifications (user_id, event_type, title, body, ticket_id, booking_id)
         VALUES ($1::uuid, $2, $3, $2, $4::uuid, $5::uuid)
         RETURNING id`,
        [note.userId, SEED_TAG, note.title, note.ticketId, note.bookingId]
      );
      console.log(`created notification=${note.title} id=${saved.rows[0].id}`);
    }
  });
}

const isMain = process.argv[1]?.endsWith("devSeedData.ts") || process.argv[1]?.endsWith("devSeedData.js");

if (isMain) {
  try {
    await seedDevData();
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "dev:seed-data failed"));
    process.exit(1);
  }
}
