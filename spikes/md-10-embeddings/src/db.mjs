// pgvector storage. One table pair per model, because each model has its own
// vector size. In the product this would be one table per (model, dims) too,
// or a single column if only one model ships.

import pg from "pg";

const URL_DEFAULT = "postgresql://moddeck:moddeck@localhost:5432/moddeck";

export async function connect() {
  // A shell-wide DATABASE_URL from another project (for example a SQLite
  // "file:" URL) wins over .env, so only use it when it points at Postgres.
  const env = process.env.DATABASE_URL;
  const url = env?.startsWith("postgres") ? env : URL_DEFAULT;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  return client;
}

const table = (model) => model.replace(/[^a-z0-9]/g, "_");
export const vec = (v) => `[${v.join(",")}]`;

export async function resetTables(db, model, dims) {
  const t = table(model);
  await db.query(`DROP TABLE IF EXISTS slide_${t}, question_${t}`);
  await db.query(`
    CREATE TABLE slide_${t} (
      id        serial PRIMARY KEY,
      deck      text NOT NULL,
      page      int  NOT NULL,
      content   text NOT NULL,
      embedding vector(${dims}) NOT NULL
    )`);
  await db.query(`
    CREATE TABLE question_${t} (
      id        text PRIMARY KEY,
      deck      text NOT NULL,
      content   text NOT NULL,
      embedding vector(${dims}) NOT NULL
    )`);
  // Cosine distance (<=>). Vectors are unit length, so inner product would
  // give the same order; cosine is the safer default.
  await db.query(`CREATE INDEX ON slide_${t} USING hnsw (embedding vector_cosine_ops)`);
  await db.query(`CREATE INDEX ON question_${t} USING hnsw (embedding vector_cosine_ops)`);
}

export async function insertSlides(db, model, slides, vectors) {
  const t = table(model);
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    await db.query(
      `INSERT INTO slide_${t} (deck, page, content, embedding) VALUES ($1, $2, $3, $4)`,
      [s.deck, s.page, s.text, vec(vectors[i])],
    );
  }
}

export async function insertQuestions(db, model, questions, vectors) {
  const t = table(model);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await db.query(
      `INSERT INTO question_${t} (id, deck, content, embedding) VALUES ($1, $2, $3, $4)`,
      [q.id, q.deck, q.text, vec(vectors[i])],
    );
  }
}

// Top-k slides of one deck for a question vector.
export async function topSlides(db, model, deck, v, k = 3) {
  const { rows } = await db.query(
    `SELECT page, 1 - (embedding <=> $1) AS sim
       FROM slide_${table(model)}
      WHERE deck = $2
      ORDER BY embedding <=> $1
      LIMIT $3`,
    [vec(v), deck, k],
  );
  return rows;
}

// Nearest earlier question in the same deck (the real-time clustering query).
export async function nearestQuestion(db, model, deck, v, excludeId) {
  const { rows } = await db.query(
    `SELECT id, 1 - (embedding <=> $1) AS sim
       FROM question_${table(model)}
      WHERE deck = $2 AND id <> $3
      ORDER BY embedding <=> $1
      LIMIT 1`,
    [vec(v), deck, excludeId],
  );
  return rows[0];
}
