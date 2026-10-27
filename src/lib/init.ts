import { prisma } from "./db";
import { hashCode, normalizeCode } from "./codes";

const DEFAULT_CHANNELS = [
  { slug: "general", name: "general", topic: "Team hangout — anything goes" },
  { slug: "planning", name: "planning", topic: "Ideas, brainstorms and plans" },
  { slug: "decisions", name: "decisions", topic: "The decisions log — final calls live here" },
];

let seedPromise: Promise<void> | null = null;

/**
 * First-run seed: default channels + the single Owner seat with its access
 * code. Idempotent — safe to call on every boot and from the join route.
 * The owner code comes from INITIAL_OWNER_CODE (see .env.example); if that
 * is unset a random code is generated and printed to the server console.
 */
export function ensureSeed(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeed().catch((err) => {
      seedPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return seedPromise;
}

async function doSeed() {
  for (const ch of DEFAULT_CHANNELS) {
    await prisma.channel.upsert({
      where: { slug: ch.slug },
      update: {},
      create: ch,
    });
  }

  const ownerCount = await prisma.seat.count({ where: { role: "Owner" } });
  if (ownerCount > 0) return;

  const envCode = process.env.INITIAL_OWNER_CODE;
  const plainCode = envCode ?? (await import("./codes")).generateCode("OWNER");
  const ownerName = process.env.OWNER_NAME || "Nahid";

  const seat = await prisma.seat.create({
    data: {
      name: ownerName,
      kind: "human",
      role: "Owner",
      color: "#f59e0b",
      avatar: "👑",
    },
  });
  await prisma.accessCode.create({
    data: { seatId: seat.id, codeHash: await hashCode(plainCode) },
  });

  console.log("\n========================================================");
  console.log("  AGENT TEAM CHAT — first run seed complete");
  console.log(`  Owner seat: ${ownerName}`);
  console.log(`  OWNER ACCESS CODE: ${normalizeCode(plainCode)}`);
  console.log("  Enter this code on the join screen to sign in as Owner.");
  console.log("  Change it later from Admin → regenerate owner code.");
  console.log("========================================================\n");
}

/** Post a system message into a channel (joins, leader changes, …). */
export async function postSystemMessage(channelSlug: string, body: string) {
  const channel = await prisma.channel.findUnique({ where: { slug: channelSlug } });
  if (!channel) return;
  await prisma.message.create({
    data: { channelId: channel.id, kind: "system", body, authorId: null },
  });
}
