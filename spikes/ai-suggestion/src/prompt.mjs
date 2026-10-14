// One prompt for both providers. The model returns JSON that matches SCHEMA.

export const SYSTEM = `You help university lecturers prepare interactive lectures in ModDeck.
ModDeck lets a lecturer insert live activities between slides:
- "quiz": multiple choice with exactly one correct answer. Checks understanding of content already shown.
- "poll": multiple choice with no correct answer. Collects opinions, experience or predictions, or starts a discussion.

Read the slide deck and suggest where to insert activities, and write each activity.
Rules:
- Suggest 1 activity per 5 to 8 slides (at least 3, at most 6). Spread them over the deck.
- "after_slide" is the slide number the activity follows. Place a quiz right after the content it tests, never before it. Do not place an activity after the title slide or the last slide.
- Prefer moments where a topic ends, before a topic change, or where students often misunderstand.
- Base every quiz only on facts that are on the slides. Do not invent facts.
- Each activity has 2 to 5 short options. A quiz has exactly one correct option and plausible wrong options. For a poll, "correct_option" is -1.
- Write "question", "options" and "explanation" in the main language of the slides. If the slides are mostly Thai, write in Thai and keep technical terms in English as the slides do.
- "reason" explains to the lecturer, in one sentence, why this point and this activity.
- "explanation" is shown to students after the answer, in one or two sentences.`;

export const userPrompt = (deck, deckText) =>
  `Deck title: ${deck.title}\nNumber of slides: ${deck.slides.length}\n\n${deckText}`;

export const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          after_slide: { type: "integer" },
          type: { type: "string", enum: ["quiz", "poll"] },
          reason: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_option: { type: "integer" },
          explanation: { type: "string" },
        },
        required: [
          "after_slide",
          "type",
          "reason",
          "question",
          "options",
          "correct_option",
          "explanation",
        ],
      },
    },
  },
  required: ["suggestions"],
};
