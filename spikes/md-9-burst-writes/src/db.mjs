// PostgreSQL side: the durable copy of every answer.

import pg from "pg";

const URL_DEFAULT = "postgresql://moddeck:moddeck@localhost:5432/moddeck";

export async function connect() {
  // A shell-wide DATABASE_URL from another project (for example a SQLite
  // "file:" URL) wins over .env, so only use it when it points at Postgres.
  const env = process.env.DATABASE_URL;
  const url = env?.startsWith("postgres") ? env : URL_DEFAULT;
  const db = new pg.Pool({ connectionString: url, max: 4 });
  // The primary key is the last guard against double answers: if Redis ever
  // lets a duplicate through (for example after it loses data), the flush
  // drops it here instead of storing it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS md9_answer (
      session_id  text        NOT NULL,
      question_id text        NOT NULL,
      user_id     text        NOT NULL,
      option      text        NOT NULL,
      points      int         NOT NULL,
      answered_at timestamptz NOT NULL,
      PRIMARY KEY (session_id, question_id, user_id)
    )`);
  return db;
}

export async function resetSession(db, sid) {
  await db.query("DELETE FROM md9_answer WHERE session_id = $1", [sid]);
}

// One INSERT per batch, however many rows. Returns the number of new rows.
export async function insertAnswers(db, sid, rows) {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO md9_answer (session_id, question_id, user_id, option, points, answered_at)
     SELECT $1, q, u, o, p, to_timestamp(t / 1000.0)
       FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::bigint[]) AS x(q, u, o, p, t)
     ON CONFLICT DO NOTHING`,
    [
      sid,
      rows.map((r) => r.q),
      rows.map((r) => r.u),
      rows.map((r) => r.o),
      rows.map((r) => Number(r.p)),
      rows.map((r) => Number(r.t)),
    ],
  );
  return res.rowCount;
}

export async function voteCounts(db, sid, qid) {
  const { rows } = await db.query(
    `SELECT option, count(*)::int AS n FROM md9_answer
      WHERE session_id = $1 AND question_id = $2 GROUP BY option`,
    [sid, qid],
  );
  return Object.fromEntries(rows.map((r) => [r.option, r.n]));
}

export async function countAnswers(db, sid) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM md9_answer WHERE session_id = $1",
    [sid],
  );
  return rows[0].n;
}

export async function topScores(db, sid, n = 10) {
  const { rows } = await db.query(
    `SELECT user_id, sum(points)::int AS score FROM md9_answer
      WHERE session_id = $1 GROUP BY user_id ORDER BY score DESC LIMIT $2`,
    [sid, n],
  );
  return rows;
}
