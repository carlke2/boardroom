import {
  UPSERT_MEMBERS_SQL,
  UPSERT_TEAM_SQL,
  SEED_TAG,
  createDevAuthUser,
  devAccounts,
  devDisplayName,
  findAuthUserByEmail,
  prepareDevSeed,
  redact,
  updateDevAuthUser,
  upsertDevProfile,
  withDevService,
  type DevAccount,
} from "./devSeed.js";

interface SeededUser {
  status: "created" | "already existed";
  role: DevAccount["role"];
  userId: string;
}

async function ensureUser(env: Awaited<ReturnType<typeof prepareDevSeed>>, account: DevAccount, resetPasswords: boolean): Promise<SeededUser> {
  const name = devDisplayName(account.role);
  const existing = await findAuthUserByEmail(env, account.email);
  let status: SeededUser["status"];
  let userId: string;
  if (!existing) {
    const created = await createDevAuthUser(env, account.email, account.password, name);
    status = "created";
    userId = created.id;
  } else {
    status = "already existed";
    userId = existing.id;
    if (resetPasswords) await updateDevAuthUser(env, userId, name, account.password);
    else await updateDevAuthUser(env, userId, name);
  }
  await withDevService(async (client) => {
    await upsertDevProfile(client, userId, name, account.email, account.role);
  });
  return { status, role: account.role, userId };
}

export async function seedDevUsers(resetPasswords: boolean): Promise<{ users: SeededUser[]; teamId: string; teamStatus: "created" | "already existed" }> {
  const env = await prepareDevSeed();
  const accounts = devAccounts(env);
  const users: SeededUser[] = [];
  for (const account of accounts) users.push(await ensureUser(env, account, resetPasswords));
  const byRole = Object.fromEntries(users.map((user) => [user.role, user.userId])) as Record<DevAccount["role"], string>;
  const team = await withDevService(async (client) => {
    const before = await client.query<{ id: string }>("SELECT id FROM public.teams WHERE name = $1", [SEED_TAG]);
    const saved = await client.query<{ id: string }>(UPSERT_TEAM_SQL, [SEED_TAG]);
    await client.query(UPSERT_MEMBERS_SQL, [saved.rows[0].id, byRole.AGENT, byRole.TEAM_LEAD]);
    return { id: saved.rows[0].id, status: before.rowCount ? "already existed" as const : "created" as const };
  });
  return { users, teamId: team.id, teamStatus: team.status };
}

function parseArgs(argv: string[]): { resetPasswords: boolean } {
  return { resetPasswords: argv.includes("--reset-passwords") };
}

const isMain = process.argv[1]?.endsWith("devSeedUsers.ts") || process.argv[1]?.endsWith("devSeedUsers.js");

if (isMain) {
  try {
    const result = await seedDevUsers(parseArgs(process.argv.slice(2)).resetPasswords);
    for (const user of result.users) {
      console.log(`${user.status} role=${user.role} userId=${user.userId}`);
    }
    console.log(`${result.teamStatus} team=${SEED_TAG} teamId=${result.teamId}`);
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "dev:seed-users failed"));
    process.exit(1);
  }
}
