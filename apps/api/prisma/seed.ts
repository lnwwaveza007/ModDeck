// Demo data: one host, one deck with a poll, no sessions. Safe to run repeatedly (fixed ids + upsert).
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: "../../.env", quiet: true });

const ids = {
  host: "00000000-0000-4000-8000-000000000001",
  deck: "00000000-0000-4000-8000-000000000002",
  slideIntro: "00000000-0000-4000-8000-000000000003",
  slidePoll: "00000000-0000-4000-8000-000000000004",
  poll: "00000000-0000-4000-8000-000000000005",
  options: [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000013",
  ],
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://moddeck:moddeck@localhost:5432/moddeck",
  }),
});

async function main() {
  const host = await prisma.user.upsert({
    where: { id: ids.host },
    update: {},
    create: {
      id: ids.host,
      ssoSubject: "demo-host-sso-subject",
      email: "demo.host@example.com",
      displayName: "Demo Host",
    },
  });

  await prisma.deck.upsert({
    where: { id: ids.deck },
    update: {},
    create: {
      id: ids.deck,
      ownerId: host.id,
      title: "Demo deck",
      settings: {
        require_sso: false,
        qa_enabled: true,
        anonymous_qa: true,
        show_results_live: true,
        auto_start_activities: false,
        reactions_enabled: true,
      },
    },
  });

  await prisma.slide.upsert({
    where: { id: ids.slideIntro },
    update: {},
    create: {
      id: ids.slideIntro,
      deckId: ids.deck,
      position: 0,
      kind: "text",
      content: { markdown: "# Welcome to ModDeck" },
    },
  });

  await prisma.slide.upsert({
    where: { id: ids.slidePoll },
    update: {},
    create: {
      id: ids.slidePoll,
      deckId: ids.deck,
      position: 1,
      kind: "activity",
    },
  });

  await prisma.activity.upsert({
    where: { id: ids.poll },
    update: {},
    create: {
      id: ids.poll,
      slideId: ids.slidePoll,
      type: "live_poll",
      prompt: "How confident are you with this topic?",
      config: { multiple: false },
    },
  });

  const labels = ["Not yet", "Somewhat", "Very"];
  for (const [position, id] of ids.options.entries()) {
    await prisma.activityOption.upsert({
      where: { id },
      update: {},
      create: { id, activityId: ids.poll, position, label: labels[position] },
    });
  }

  console.log(
    `Seeded host ${host.displayName}, deck "Demo deck" with 1 poll (${labels.length} options).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
