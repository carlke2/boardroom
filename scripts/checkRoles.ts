/**
 * Live role matrix. Prompts for each login in the terminal (hidden input).
 * Never reads credentials from files. Prints no tokens.
 */
import { getEnv, runEnvCheck } from "../config/env.js";
import { connectPostgres, getPool } from "../db/postgres.js";
import { loadRosterFile, promptHiddenPassword, redact, type Roster } from "./seedLib.js";

interface Session {
  role: string;
  email: string;
  userId: string;
  token: string;
}

async function login(base: string, email: string, password: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function request(
  base: string,
  method: string,
  path: string,
  token?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

function codeOf(body: Record<string, unknown>): string {
  return typeof body.code === "string" ? body.code : body.ok === true ? "ok" : "error";
}

async function main(): Promise<void> {
  runEnvCheck();
  const env = getEnv();
  await connectPostgres();
  const roster: Roster = loadRosterFile();
  const base = `http://127.0.0.1:${env.PORT}`;
  const byRole = new Map<string, { email: string; name: string }>();
  for (const person of roster.people) {
    if (!byRole.has(person.role)) byRole.set(person.role, { email: person.email, name: person.name });
  }
  const users = roster.people.filter((person) => person.role === "USER");
  if (users.length < 2) throw new Error("Roster needs two USER people for isolation checks");

  const sessions = new Map<string, Session>();
  for (const role of ["USER", "AGENT", "TEAM_LEAD", "ADMIN"]) {
    const person = byRole.get(role);
    if (!person) {
      console.log(`skip role=${role} (missing from roster)`);
      continue;
    }
    const password = await promptHiddenPassword(`Password for ${role}: `);
    const result = await login(base, person.email, password);
    const token = typeof result.body.accessToken === "string" ? result.body.accessToken : "";
    const user = result.body.user && typeof result.body.user === "object" ? (result.body.user as Record<string, unknown>) : null;
    console.log(`login role=${role} status=${result.status} meRole=${user?.role ?? "absent"}`);
    if (result.status !== 200 || !token) throw new Error(`Login failed for role ${role}`);
    const me = await request(base, "GET", "/auth/me", token);
    const meUser = me.body.user && typeof me.body.user === "object" ? (me.body.user as Record<string, unknown>) : null;
    console.log(`me role=${role} status=${me.status} reported=${meUser?.role ?? "absent"}`);
    if (meUser?.role !== role) throw new Error(`/auth/me role mismatch for ${role}`);
    sessions.set(role, {
      role,
      email: person.email,
      userId: String(meUser?.id ?? ""),
      token,
    });
  }

  const userA = sessions.get("USER");
  if (!userA) throw new Error("USER session missing");
  const userBEmail = users.find((person) => person.email !== userA.email)?.email;
  if (!userBEmail) throw new Error("Second USER missing");
  const passwordB = await promptHiddenPassword("Password for second USER: ");
  const loginB = await login(base, userBEmail, passwordB);
  const tokenB = typeof loginB.body.accessToken === "string" ? loginB.body.accessToken : "";
  if (!tokenB) throw new Error("Second USER login failed");

  const ticketsA = await request(base, "GET", "/tickets?limit=5", userA.token);
  const list = Array.isArray(ticketsA.body.tickets) ? (ticketsA.body.tickets as Array<Record<string, unknown>>) : [];
  const ticketId = typeof list[0]?.id === "string" ? list[0].id : "";
  console.log(`userA.tickets status=${ticketsA.status} count=${list.length}`);

  const rows: Array<[string, string, string, string]> = [];
  const check = async (role: string, method: string, path: string, token?: string, expect?: number) => {
    const result = await request(base, method, path, token);
    const label = `${result.status}/${codeOf(result.body)}`;
    rows.push([role, `${method} ${path}`, label, expect && result.status !== expect ? "FAIL" : "ok"]);
    return result;
  };

  await check("anonymous", "GET", "/tickets");
  await check("anonymous", "GET", "/dashboard/admin");
  await check("USER", "GET", "/dashboard/user", userA.token, 200);
  await check("USER", "GET", "/dashboard/staff", userA.token, 403);
  await check("USER", "GET", "/dashboard/admin", userA.token, 403);
  await check("USER", "GET", "/admin/ping", userA.token, 403);
  if (ticketId) {
    const foreign = await check("USER_B", "GET", `/tickets/${ticketId}`, tokenB);
    const detail = foreign.body.ticket && typeof foreign.body.ticket === "object" ? (foreign.body.ticket as Record<string, unknown>) : null;
    const staffLeak = detail && (detail.assigneeId != null || detail.teamId != null || detail.resolutionNote != null);
    const comments = Array.isArray(detail?.comments) ? (detail.comments as Array<Record<string, unknown>>) : [];
    const internal = comments.some((comment) => comment.isInternal === true);
    rows.push(["USER_B", `GET /tickets/${ticketId} isolation`, foreign.status === 403 || !detail ? "blocked" : "opened", staffLeak || internal ? "FAIL" : "ok"]);
  }
  const agent = sessions.get("AGENT");
  if (agent) {
    await check("AGENT", "GET", "/dashboard/staff", agent.token, 200);
    await check("AGENT", "GET", "/dashboard/admin", agent.token, 403);
    await check("AGENT", "GET", "/admin/ping", agent.token, 403);
  }
  const lead = sessions.get("TEAM_LEAD");
  if (lead) {
    await check("TEAM_LEAD", "GET", "/dashboard/staff", lead.token, 200);
    await check("TEAM_LEAD", "GET", "/admin/ping", lead.token, 403);
  }
  const admin = sessions.get("ADMIN");
  if (admin) {
    await check("ADMIN", "GET", "/dashboard/admin", admin.token, 200);
    await check("ADMIN", "GET", "/admin/ping", admin.token, 200);
  }

  console.log("role\trequest\tresult\tnote");
  for (const row of rows) console.log(row.join("\t"));

  const explain = await getPool().query(
    `select
       (explain (analyze, format text) select public.dashboard_admin()) as plan`
  );
  // Prefer separate explains with jwt claims
  await getPool().query("begin");
  if (admin) {
    await getPool().query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: admin.userId, role: "authenticated", user_role: "ADMIN" }),
    ]);
    await getPool().query("set local role authenticated");
    for (const [name, sql] of [
      ["dashboard_admin", "explain (analyze, format text) select public.dashboard_admin()"],
      ["list_tickets", "explain (analyze, format text) select * from public.list_tickets(50, null, null, null, null, null, null, null)"],
      ["dashboard_counts", "explain (analyze, format text) select public.dashboard_counts()"],
    ] as const) {
      try {
        const plan = await getPool().query(sql);
        const text = plan.rows.map((row) => Object.values(row)[0]).join("\n");
        const exec = text.match(/Execution Time: ([0-9.]+) ms/);
        const planning = text.match(/Planning Time: ([0-9.]+) ms/);
        console.log(`explain.${name}.planning_ms=${planning?.[1] ?? "n/a"}`);
        console.log(`explain.${name}.execution_ms=${exec?.[1] ?? "n/a"}`);
      } catch (error) {
        console.log(`explain.${name}.error=${redact(error instanceof Error ? error.message : "failed")}`);
      }
    }
  }
  await getPool().query("rollback");
  void explain;
}

const isMain = process.argv[1]?.endsWith("checkRoles.ts") || process.argv[1]?.endsWith("checkRoles.js");
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "check:roles failed"));
    process.exit(1);
  }
}
