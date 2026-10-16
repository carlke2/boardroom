import type { UserRole } from "../types/auth.js";
import {
  assertSeedAllowed,
  createAdminFetch,
  createAuthUser,
  findAuthUserByEmail,
  loadRosterFile,
  minPasswordLength,
  prepareSeed,
  promptHiddenPassword,
  redact,
  sendSetPasswordEmail,
  tagExistingAuthUser,
  upsertProfile,
  withSeedService,
  type PromptPassword,
  type Roster,
} from "./seedLib.js";

export interface SeedUsersOptions {
  invite: boolean;
  prompt?: PromptPassword;
  roster?: Roster;
}

export interface SeededPerson {
  status: "created" | "already existed";
  role: UserRole;
  userId: string;
}

export async function seedUsers(options: SeedUsersOptions): Promise<SeededPerson[]> {
  const env = await prepareSeed();
  assertSeedAllowed(env);
  const roster = options.roster ?? loadRosterFile();
  const owner = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  if (roster.people.some((person) => person.email === owner)) {
    throw new Error("Roster must not include the owner admin email (SEED_ADMIN_EMAIL)");
  }
  const admin = createAdminFetch(env);
  const prompt = options.prompt ?? promptHiddenPassword;
  const results: SeededPerson[] = [];
  const ids = new Map<string, string>();

  for (const person of roster.people) {
    const existing = await findAuthUserByEmail(admin, person.email);
    let status: SeededPerson["status"];
    let userId: string;
    if (!existing) {
      if (options.invite) {
        const created = await createAuthUser(admin, {
          email: person.email,
          name: person.name,
          phone: person.phone ?? "",
          seedTag: roster.seedTag,
        });
        await sendSetPasswordEmail(admin, person.email);
        status = "created";
        userId = created.id;
      } else {
        const first = await prompt(`Password for ${person.role} (${person.email}): `);
        const again = await prompt(`Confirm password for ${person.role}: `);
        if (first !== again) throw new Error(`Password confirmation mismatch for role ${person.role}`);
        const minLen = await withSeedService((client) => minPasswordLength(client, env));
        if (first.length < minLen) {
          throw new Error(`Password for role ${person.role} is shorter than the minimum length`);
        }
        const created = await createAuthUser(admin, {
          email: person.email,
          name: person.name,
          phone: person.phone ?? "",
          seedTag: roster.seedTag,
          password: first,
        });
        status = "created";
        userId = created.id;
      }
    } else {
      status = "already existed";
      userId = existing.id;
      await tagExistingAuthUser(admin, userId, person.name, person.phone ?? "", roster.seedTag);
      if (options.invite) await sendSetPasswordEmail(admin, person.email);
    }
    await withSeedService((client) =>
      upsertProfile(client, userId, person.name, person.email, person.phone ?? "", person.role)
    );
    ids.set(person.email, userId);
    results.push({ status, role: person.role, userId });
    console.log(`${status} role=${person.role} userId=${userId}`);
  }

  await withSeedService(async (client) => {
    for (const team of roster.teams) {
      const saved = await client.query<{ id: string }>(
        `INSERT INTO public.teams (name, active)
         VALUES ($1, true)
         ON CONFLICT (name) DO UPDATE SET active = true
         RETURNING id`,
        [team.name]
      );
      const teamId = saved.rows[0].id;
      const leadId = ids.get(team.leadEmail);
      if (!leadId) throw new Error("Roster team lead is missing after seed");
      await client.query(
        `INSERT INTO public.team_members (team_id, profile_id, is_lead)
         VALUES ($1::uuid, $2::uuid, true)
         ON CONFLICT (team_id, profile_id) DO UPDATE SET is_lead = true`,
        [teamId, leadId]
      );
      for (const memberEmail of team.memberEmails) {
        const memberId = ids.get(memberEmail);
        if (!memberId) throw new Error("Roster team member is missing after seed");
        await client.query(
          `INSERT INTO public.team_members (team_id, profile_id, is_lead)
           VALUES ($1::uuid, $2::uuid, false)
           ON CONFLICT (team_id, profile_id) DO UPDATE SET is_lead = EXCLUDED.is_lead`,
          [teamId, memberId]
        );
      }
      console.log(`team upserted name=${team.name} teamId=${teamId}`);
    }
  });

  return results;
}

const isMain = process.argv[1]?.endsWith("seedUsers.ts") || process.argv[1]?.endsWith("seedUsers.js");
if (isMain) {
  try {
    await seedUsers({ invite: process.argv.includes("--invite") });
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "seed:users failed"));
    process.exit(1);
  }
}
