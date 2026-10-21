// Demo data: one host, one deck with a title slide and a Live Poll.
// Safe to run more than once: it does nothing if the demo deck exists.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const LOCAL_DATABASE_URL = "postgresql://moddeck:moddeck@localhost:5432/moddeck";

const DEMO_HOST_SUBJECT = "demo-host";
const DEMO_DECK_TITLE = "Demo deck";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL }),
});

async function main() {
  const host = await prisma.user.upsert({
    where: { ssoSubject: DEMO_HOST_SUBJECT },
    update: {},
    create: {
      ssoSubject: DEMO_HOST_SUBJECT,
      email: "demo.host@example.com",
      displayName: "Demo Host",
    },
  });

  const existing = await prisma.deck.findFirst({
    where: { ownerId: host.id, title: DEMO_DECK_TITLE },
  });
  if (existing) {
    console.log(`Seed: demo deck already exists (${existing.id}), nothing to do.`);
    return;
  }

  const deck = await prisma.deck.create({
    data: {
      ownerId: host.id,
      title: DEMO_DECK_TITLE,
      slides: {
        create: [
          {
            position: 0,
            kind: "text",
            content: "# Welcome to ModDeck\n\nJoin with the PIN on screen.",
          },
          {
            position: 1,
            kind: "poll",
            activity: {
              create: {
                type: "poll",
                prompt: "Which data structure gives $O(1)$ average lookup?",
                options: {
                  create: [
                    { position: 0, label: "Linked list" },
                    { position: 1, label: "Hash table" },
                    { position: 2, label: "Binary search tree" },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  });
  console.log(`Seed: created demo host ${host.id} and deck ${deck.id}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
