import pg from 'pg';
import { RUN_ENV, requireRunEnv } from './config';

// Direct SQL against the throwaway e2e database. Used for what a user cannot do through the UI:
// reading ground truth (payment ids, ledger) and moving time (back-dating timestamps — the
// system has no fake clock, see workers/jobs/CLAUDE.md "Driving time").

export async function query<Row extends object>(
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: requireRunEnv(RUN_ENV.databaseUrl) });
  await client.connect();
  try {
    const result = await client.query<Row>(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function one<Row extends object>(sql: string, params: unknown[] = []): Promise<Row> {
  const rows = await query<Row>(sql, params);
  const row = rows[0];
  if (row === undefined) throw new Error(`expected a row from: ${sql}`);
  return row;
}
