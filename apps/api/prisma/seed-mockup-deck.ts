// Fills a deck with a mockup lecture that uses every slide feature: heading, text, image, code,
// formula and Live Poll. Run it from apps/api:
//
//   pnpm db:mockup <deckId>             adds the slides after the existing ones
//   pnpm db:mockup <deckId> --replace   removes the existing slides first
//
// The deck must already exist (create it in the app first). The elements are checked with the
// same zod schema the api uses, so a slide that would be rejected by the editor fails here.
// The image is copied into the slides folder (SLIDES_DIR, default ./data/slides), which must be
// the folder the api reads from. In docker that is the `slides` volume of the api container.

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  slideElementsSchema,
  type CodeLanguage,
  type SlideElement,
  type TextAlign,
} from "@moddeck/shared";
import { PrismaClient } from "../src/generated/prisma/client";

const LOCAL_DATABASE_URL = "postgresql://moddeck:moddeck@localhost:5432/moddeck";
const IMAGE_SOURCE = join(__dirname, "mockup", "hash-table.png");

// Font sizes are stored as percent of the stage width; the editor shows them as PowerPoint pt.
const pt = (points: number) => Math.round(((points * 100) / 960) * 1000) / 1000;

const heading = (text: string, y = 7, align: TextAlign = "left"): SlideElement => ({
  id: randomUUID(),
  type: "text",
  x: 8,
  y,
  w: 84,
  text,
  size: pt(44),
  bold: true,
  align,
});

const text = (
  body: string,
  box: { x?: number; y: number; w?: number },
  opts: { size?: number; bold?: boolean; align?: TextAlign } = {},
): SlideElement => ({
  id: randomUUID(),
  type: "text",
  x: box.x ?? 8,
  y: box.y,
  w: box.w ?? 84,
  text: body,
  size: pt(opts.size ?? 24),
  bold: opts.bold ?? false,
  align: opts.align ?? "left",
});

const code = (
  source: string,
  language: CodeLanguage,
  box: { x?: number; y: number; w?: number; h?: number },
  points = 18,
): SlideElement => ({
  id: randomUUID(),
  type: "code",
  x: box.x ?? 8,
  y: box.y,
  w: box.w ?? 84,
  ...(box.h !== undefined && { h: box.h }),
  code: source,
  language,
  size: pt(points),
});

const math = (
  latex: string,
  box: { x?: number; y: number; w?: number },
  points = 36,
): SlideElement => ({
  id: randomUUID(),
  type: "math",
  x: box.x ?? 10,
  y: box.y,
  w: box.w ?? 80,
  latex,
  size: pt(points),
  align: "center",
});

const image = (
  imageRef: string,
  box: { x: number; y: number; w: number; h: number },
): SlideElement => ({ id: randomUUID(), type: "image", ...box, imageRef });

interface PollSpec {
  prompt: string;
  options: string[];
}

type SlideSpec = { kind: "content"; elements: SlideElement[] } | { kind: "poll"; poll: PollSpec };

function buildSlides(imageRef: string): SlideSpec[] {
  return [
    // 1. Title: heading, subtitle and small text, centered.
    {
      kind: "content",
      elements: [
        text("Intro to Data Structures", { y: 28 }, { size: 60, bold: true, align: "center" }),
        text("Week 3: hash tables and fast lookup", { y: 50 }, { size: 28, align: "center" }),
        text(
          "ModDeck mockup deck. Join with the PIN on screen to vote in the polls.",
          { y: 86 },
          { size: 16, align: "center" },
        ),
      ],
    },

    // 2. Heading + text with inline code and inline math.
    {
      kind: "content",
      elements: [
        heading("Today's agenda"),
        text(
          [
            "1. Why a plain list is slow: finding an item takes $O(n)$ steps.",
            "2. How a hash table finds an item in $O(1)$ on average.",
            "3. Writing one in code: `dict` in Python, `Map` in JavaScript.",
            "4. Load factor and what happens when buckets fill up.",
            "5. Two quick Live Polls to check what you remember.",
          ].join("\n\n"),
          { y: 26 },
          { size: 26 },
        ),
      ],
    },

    // 3. Text next to an image.
    {
      kind: "content",
      elements: [
        heading("Why hash tables?"),
        text(
          [
            "A hash function turns a key into a bucket number, so we jump straight to the right place.",
            "Keys that land in the same bucket form a short chain.",
            "Lookup cost stays around $O(1)$ while chains stay short.",
          ].join("\n\n"),
          { w: 42, y: 26 },
          { size: 22 },
        ),
        image(imageRef, { x: 54, y: 24, w: 40, h: 40 }),
      ],
    },

    // 4. Code: Python, with a heading and a caption.
    {
      kind: "content",
      elements: [
        heading("Hash table in Python"),
        code(
          [
            "class HashTable:",
            "    def __init__(self, size=8):",
            "        self.buckets = [[] for _ in range(size)]",
            "",
            "    def put(self, key, value):",
            "        bucket = self.buckets[hash(key) % len(self.buckets)]",
            "        bucket.append((key, value))",
            "",
            "    def get(self, key):",
            "        for k, v in self.buckets[hash(key) % len(self.buckets)]:",
            "            if k == key:",
            "                return v",
          ].join("\n"),
          "python",
          { y: 22, h: 62 },
          17,
        ),
        text(
          "Each bucket is a list: this is the chaining from the last slide.",
          { y: 88 },
          { size: 16 },
        ),
      ],
    },

    // 5. Code: two languages side by side.
    {
      kind: "content",
      elements: [
        heading("Same idea, two languages"),
        text("Python", { x: 8, y: 22, w: 40 }, { size: 20, bold: true }),
        code(
          [
            'ages = {"Ada": 36, "Linus": 28}',
            'ages["Grace"] = 85',
            "",
            'print(ages["Ada"])  # 36',
            'print("Bob" in ages)  # False',
          ].join("\n"),
          "python",
          { x: 8, y: 30, w: 40, h: 40 },
          15,
        ),
        text("JavaScript", { x: 52, y: 22, w: 40 }, { size: 20, bold: true }),
        code(
          [
            "const ages = new Map();",
            'ages.set("Ada", 36);',
            'ages.set("Grace", 85);',
            "",
            'console.log(ages.get("Ada")); // 36',
            'console.log(ages.has("Bob")); // false',
          ].join("\n"),
          "javascript",
          { x: 52, y: 30, w: 40, h: 40 },
          15,
        ),
        text("Both read and write in $O(1)$ on average.", { y: 78 }, { size: 22, align: "center" }),
      ],
    },

    // 6. Formula: display math plus a text line with inline math.
    {
      kind: "content",
      elements: [
        heading("Load factor"),
        text("With $n$ keys stored in $m$ buckets, the load factor is", { y: 24 }, { size: 24 }),
        math("\\alpha = \\frac{n}{m}", { y: 34 }, 48),
        text(
          "For chaining, a lookup scans $1 + \\alpha$ items on average. Keep $\\alpha \\le 1$ and it stays constant.",
          { y: 76 },
          { size: 22 },
        ),
      ],
    },

    // 7. Everything on one slide: heading, text, code, formula.
    {
      kind: "content",
      elements: [
        heading("Putting it together"),
        text("Resize when the table gets crowded:", { w: 40, y: 24 }, { size: 22 }),
        code(
          [
            "def put(self, key, value):",
            "    ...",
            "    if self.count / len(self.buckets) > 0.75:",
            "        self._resize(2 * len(self.buckets))",
          ].join("\n"),
          "python",
          { w: 52, y: 36 },
          17,
        ),
        text("Cost of growing", { x: 66, y: 24, w: 26 }, { size: 18, bold: true, align: "center" }),
        math("T(n) = \\sum_{i=0}^{k} 2^i \\le 2n", { x: 62, y: 42, w: 34 }, 28),
        text(
          "Doubling makes each insert $O(1)$ amortized.",
          { x: 62, y: 70, w: 34 },
          { size: 16, align: "center" },
        ),
      ],
    },

    // 8. Live Poll: single answer, with inline math in the question.
    {
      kind: "poll",
      poll: {
        prompt: "Which data structure gives $O(1)$ average lookup by key?",
        options: ["Linked list", "Hash table", "Binary search tree", "Sorted array"],
      },
    },

    // 9. Live Poll: concept check.
    {
      kind: "poll",
      poll: {
        prompt: "Two keys land in the same bucket. What is that called?",
        options: ["A collision", "An overflow", "A rehash", "A checksum", "I am not sure yet"],
      },
    },

    // 10. Recap.
    {
      kind: "content",
      elements: [
        heading("Recap", 24, "center"),
        text(
          [
            "A hash function maps a key to a bucket.",
            "Chaining handles collisions.",
            "Lookup is $O(1)$ on average while $\\alpha$ stays small.",
          ].join("\n\n"),
          { x: 15, y: 42, w: 70 },
          { size: 26, align: "center" },
        ),
        text("Thank you. Questions?", { y: 82 }, { size: 20, bold: true, align: "center" }),
      ],
    },
  ];
}

async function main() {
  const [deckId, flag] = process.argv.slice(2);
  if (!deckId || (flag !== undefined && flag !== "--replace")) {
    console.error("Usage: pnpm db:mockup <deckId> [--replace]");
    process.exitCode = 1;
    return;
  }
  const replace = flag === "--replace";

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL }),
  });

  try {
    const deck = await prisma.deck.findFirst({ where: { id: deckId, deletedAt: null } });
    if (!deck) {
      console.error(`No deck with id ${deckId}. Create the deck in the app first.`);
      process.exitCode = 1;
      return;
    }

    const imagesDir = process.env.SLIDES_DIR ?? join(process.cwd(), "data", "slides");
    await mkdir(imagesDir, { recursive: true });
    const imageRef = `${randomUUID()}.png`;
    await copyFile(IMAGE_SOURCE, join(imagesDir, imageRef));

    const slides = buildSlides(imageRef);
    for (const slide of slides) {
      if (slide.kind === "content") slideElementsSchema.parse(slide.elements);
    }

    await prisma.$transaction(async (tx) => {
      if (replace) await tx.slide.deleteMany({ where: { deckId } });
      const start = replace ? 0 : await tx.slide.count({ where: { deckId } });

      for (const [index, slide] of slides.entries()) {
        const position = start + index;
        if (slide.kind === "content") {
          await tx.slide.create({
            data: {
              deckId,
              position,
              kind: "content",
              elements: slide.elements as unknown as object[],
            },
          });
        } else {
          await tx.slide.create({
            data: {
              deckId,
              position,
              kind: "poll",
              elements: [],
              activity: {
                create: {
                  type: "poll",
                  prompt: slide.poll.prompt,
                  options: {
                    create: slide.poll.options.map((label, i) => ({ position: i, label })),
                  },
                },
              },
            },
          });
        }
      }
      await tx.deck.update({ where: { id: deckId }, data: { updatedAt: new Date() } });
    });

    console.log(
      `Added ${slides.length} slides to "${deck.title}" (${deckId})${replace ? ", replacing the old ones" : ""}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
