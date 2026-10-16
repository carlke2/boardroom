import {
  loadRosterFile,
  prepareSeed,
  redact,
  withSeedService,
} from "./seedLib.js";

/**
 * Seeds rooms, categories, tickets, comments, bookings, and notifications.
 * Creates no Auth users or profiles. Requires seed:users first.
 */
export async function seedData(): Promise<void> {
  const env = await prepareSeed();
  const roster = loadRosterFile();
  const tag = roster.seedTag;
  const users = roster.people.filter((person) => person.role === "USER");
  if (users.length < 2) throw new Error("Roster needs at least two USER people for seed:data");
  const agent = roster.people.find((person) => person.role === "AGENT");
  if (!agent) throw new Error("Roster needs an AGENT for seed:data");

  await withSeedService(async (client) => {
    await client.query("SELECT set_config('app.ticket_transition', 'on', true)");
    const requesterRows = await client.query<{ id: string; email: string }>(
      `select p.id::text as id, lower(p.email) as email
       from public.profiles p
       where lower(p.email) = any($1::text[])`,
      [users.map((user) => user.email)]
    );
    const agentRow = await client.query<{ id: string }>(
      `select id::text as id from public.profiles where lower(email) = $1`,
      [agent.email]
    );
    if ((requesterRows.rowCount ?? 0) < 2 || !agentRow.rows[0]) {
      throw new Error("Seed people are missing in profiles. Run seed:users first");
    }
    const requesterA = requesterRows.rows.find((row) => row.email === users[0].email)?.id;
    const requesterB = requesterRows.rows.find((row) => row.email === users[1].email)?.id;
    const agentId = agentRow.rows[0].id;
    if (!requesterA || !requesterB) throw new Error("Seed USER emails are missing in profiles");

    for (const [index, name] of [`${tag} room 1`, `${tag} room 2`].entries()) {
      const before = await client.query("select id from public.rooms where name = $1", [name]);
      const saved = await client.query<{ id: string }>(
        `insert into public.rooms (name, capacity, is_active, location, notes)
         values ($1, $2, true, $3, $3)
         on conflict (name) do update set is_active = true
         returning id`,
        [name, index === 0 ? 8 : 12, tag]
      );
      console.log(`${before.rowCount ? "already existed" : "created"} room id=${saved.rows[0].id}`);
    }

    const categoryBefore = await client.query("select id from public.ticket_categories where name = $1", [tag]);
    const category = await client.query<{ id: string }>(
      `insert into public.ticket_categories (name, default_priority, active)
       values ($1, 'MEDIUM', true)
       on conflict (name) do update set active = true
       returning id`,
      [tag]
    );
    console.log(`${categoryBefore.rowCount ? "already existed" : "created"} category id=${category.rows[0].id}`);

    const tickets = [
      { number: `${tag}-1`, subject: "Printer jam", status: "NEW", priority: "LOW", requester: requesterA, sla: "on_track" },
      { number: `${tag}-2`, subject: "VPN down", status: "OPEN", priority: "HIGH", requester: requesterA, sla: "breached" },
      { number: `${tag}-3`, subject: "Badge fault", status: "IN_PROGRESS", priority: "MEDIUM", requester: requesterB, sla: "at_risk" },
      { number: `${tag}-4`, subject: "Mailbox full", status: "PENDING_CUSTOMER", priority: "URGENT", requester: requesterB, sla: "paused" },
      { number: `${tag}-5`, subject: "Monitor flicker", status: "RESOLVED", priority: "LOW", requester: requesterA, sla: "met" },
    ] as const;

    const ticketIds = new Map<string, string>();
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    for (const ticket of tickets) {
      const before = await client.query("select id from public.tickets where number = $1", [ticket.number]);
      const saved = await client.query<{ id: string }>(
        `insert into public.tickets (number, subject, description, status, priority, category_id, requester_id, channel, source_ref)
         values ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, 'SYSTEM', $3)
         on conflict (number) do update
         set subject = excluded.subject, status = excluded.status, priority = excluded.priority,
             category_id = excluded.category_id, requester_id = excluded.requester_id, source_ref = excluded.source_ref
         returning id`,
        [ticket.number, ticket.subject, tag, ticket.status, ticket.priority, category.rows[0].id, ticket.requester]
      );
      ticketIds.set(ticket.number, saved.rows[0].id);
      const sla =
        ticket.sla === "breached"
          ? [new Date(now - 2 * hour), new Date(now - hour), new Date(now - hour), new Date(now - 30 * 60 * 1000), null, null]
          : ticket.sla === "at_risk"
            ? [new Date(now + 20 * 60 * 1000), new Date(now + 25 * 60 * 1000), null, null, null, null]
            : ticket.sla === "paused"
              ? [new Date(now + 4 * hour), new Date(now + 8 * hour), null, null, new Date(now - 15 * 60 * 1000), null]
              : ticket.sla === "met"
                ? [new Date(now - 3 * hour), new Date(now + 4 * hour), null, null, null, new Date(now - hour)]
                : [new Date(now + 4 * hour), new Date(now + 8 * hour), null, null, null, null];
      await client.query(
        `insert into public.ticket_staff (
           ticket_id, assignee_id, sla_response_due, sla_resolution_due,
           sla_response_breached_at, sla_resolution_breached_at, sla_paused_at, resolved_at
         ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
         on conflict (ticket_id) do update set
           assignee_id = excluded.assignee_id,
           sla_response_due = excluded.sla_response_due,
           sla_resolution_due = excluded.sla_resolution_due,
           sla_response_breached_at = excluded.sla_response_breached_at,
           sla_resolution_breached_at = excluded.sla_resolution_breached_at,
           sla_paused_at = excluded.sla_paused_at,
           resolved_at = excluded.resolved_at`,
        [saved.rows[0].id, agentId, ...sla]
      );
      console.log(`${before.rowCount ? "already existed" : "created"} ticket=${ticket.number}`);
    }

    for (const comment of [
      { number: `${tag}-2`, body: `${tag} internal note 1` },
      { number: `${tag}-3`, body: `${tag} internal note 2` },
    ]) {
      const ticketId = ticketIds.get(comment.number)!;
      const before = await client.query(
        "select id from public.ticket_comments where ticket_id = $1::uuid and body = $2",
        [ticketId, comment.body]
      );
      if (before.rowCount) {
        console.log(`already existed comment ticket=${comment.number}`);
        continue;
      }
      await client.query(
        `insert into public.ticket_comments (ticket_id, author_id, body, is_internal)
         values ($1::uuid, $2::uuid, $3, true)`,
        [ticketId, agentId, comment.body]
      );
      console.log(`created comment ticket=${comment.number}`);
    }

    const rooms = await client.query<{ id: string }>(
      "select id from public.rooms where name like $1 order by name",
      [`${tag} %`]
    );
    const tz = env.TIMEZONE;
    const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const pick = (type: string) => Number(dayParts.find((part) => part.type === type)?.value);
    const zoneOffset = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(date);
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - date.getTime();
    };
    const at = (dayOffset: number, hour: number) => {
      const guess = new Date(Date.UTC(pick("year"), pick("month") - 1, pick("day") + dayOffset, hour, 0, 0));
      return new Date(guess.getTime() - zoneOffset(guess));
    };
    for (const booking of [
      { title: `${tag} booking today`, roomId: rooms.rows[0].id, start: at(0, 10), end: at(0, 11) },
      { title: `${tag} booking later`, roomId: rooms.rows[1].id, start: at(1, 10), end: at(1, 11) },
    ]) {
      const before = await client.query(
        "select id from public.bookings where meeting_title = $1 and team_name = $2",
        [booking.title, tag]
      );
      if (before.rowCount) {
        console.log(`already existed booking=${booking.title}`);
        continue;
      }
      await client.query(
        `insert into public.bookings (
           user_id, room_id, attendee_count, attendees, team_name, meeting_title,
           duration_minutes, start_at, end_at, status
         ) values ($1::uuid, $2::uuid, 2, '{}', $3, $4, 60, $5, $6, 'CONFIRMED')`,
        [requesterA, booking.roomId, tag, booking.title, booking.start, booking.end]
      );
      console.log(`created booking=${booking.title}`);
    }

    const todayBooking = await client.query<{ id: string }>(
      "select id from public.bookings where meeting_title = $1 and team_name = $2",
      [`${tag} booking today`, tag]
    );
    for (const note of [
      { title: `${tag}: ticket opened`, userId: requesterA, ticketId: ticketIds.get(`${tag}-1`)!, bookingId: null as string | null },
      { title: `${tag}: assigned`, userId: agentId, ticketId: ticketIds.get(`${tag}-2`)!, bookingId: null as string | null },
      { title: `${tag}: booking today`, userId: requesterA, ticketId: null as string | null, bookingId: todayBooking.rows[0]?.id ?? null },
    ]) {
      const before = await client.query(
        "select id from public.notifications where user_id = $1::uuid and title = $2 and event_type = $3",
        [note.userId, note.title, tag]
      );
      if (before.rowCount) {
        console.log(`already existed notification`);
        continue;
      }
      await client.query(
        `insert into public.notifications (user_id, event_type, title, body, ticket_id, booking_id)
         values ($1::uuid, $2, $3, $2, $4::uuid, $5::uuid)`,
        [note.userId, tag, note.title, note.ticketId, note.bookingId]
      );
      console.log(`created notification`);
    }
  });
}

const isMain = process.argv[1]?.endsWith("seedData.ts") || process.argv[1]?.endsWith("seedData.js");
if (isMain) {
  try {
    await seedData();
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "seed:data failed"));
    process.exit(1);
  }
}
