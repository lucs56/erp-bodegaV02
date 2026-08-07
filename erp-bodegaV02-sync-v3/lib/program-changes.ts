import "server-only";
import { getD1Database } from "../db";
import type { LiveProgram } from "./google-sheets";
import {
  diffProgramDetailed,
  type DetailedProgramDiff,
} from "./program-diff";

export type StoredProgramChange = DetailedProgramDiff & {
  detectedAt: string;
  previousFetchedAt: string | null;
  currentFetchedAt: string;
};

export async function storeProgramChange(
  previous: LiveProgram,
  current: LiveProgram,
) {
  const before = previous.weeks.flatMap((week) => week.records);
  const after = current.weeks.flatMap((week) => week.records);
  const change = diffProgramDetailed(before, after);
  if (!change.total) return null;

  const database = await getD1Database();
  const detectedAt = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO program_change_events (
          detected_at, previous_fetched_at, current_fetched_at,
          added_count, modified_count, removed_count, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        detectedAt,
        previous.fetchedAt || null,
        current.fetchedAt,
        change.added,
        change.modified,
        change.removed,
        JSON.stringify(change),
      ),
    database.prepare(
      `DELETE FROM program_change_events
       WHERE id NOT IN (
         SELECT id FROM program_change_events
         ORDER BY id DESC
         LIMIT 100
       )`,
    ),
  ]);

  return {
    ...change,
    detectedAt,
    previousFetchedAt: previous.fetchedAt || null,
    currentFetchedAt: current.fetchedAt,
  } satisfies StoredProgramChange;
}

type StoredChangeRow = {
  detected_at: string;
  previous_fetched_at: string | null;
  current_fetched_at: string;
  added_count: number;
  modified_count: number;
  removed_count: number;
  details_json: string;
};

export async function readLatestProgramChange(
  maxAgeHours = 48,
): Promise<StoredProgramChange | null> {
  try {
    const database = await getD1Database();
    const row = (await database
      .prepare(
        `SELECT
          detected_at, previous_fetched_at, current_fetched_at,
          added_count, modified_count, removed_count, details_json
         FROM program_change_events
         ORDER BY id DESC
         LIMIT 1`,
      )
      .first()) as StoredChangeRow | null;
    if (!row) return null;
    const age = Date.now() - new Date(row.detected_at).getTime();
    if (!Number.isFinite(age) || age > maxAgeHours * 60 * 60 * 1000)
      return null;

    const details = JSON.parse(row.details_json) as DetailedProgramDiff;
    return {
      ...details,
      added: Number(row.added_count),
      modified: Number(row.modified_count),
      removed: Number(row.removed_count),
      total:
        Number(row.added_count) +
        Number(row.modified_count) +
        Number(row.removed_count),
      detectedAt: row.detected_at,
      previousFetchedAt: row.previous_fetched_at,
      currentFetchedAt: row.current_fetched_at,
    } satisfies StoredProgramChange;
  } catch {
    return null;
  }
}

export async function readRecentProgramChanges(
  limit = 5,
): Promise<StoredProgramChange[]> {
  try {
    const database = await getD1Database();
    const rows = (await database
      .prepare(
        `SELECT
          detected_at, previous_fetched_at, current_fetched_at,
          added_count, modified_count, removed_count, details_json
         FROM program_change_events
         ORDER BY id DESC
         LIMIT ?`,
      )
      .bind(Math.max(1, Math.min(20, Math.trunc(limit))))
      .all()) as { results: StoredChangeRow[] };

    return rows.results.map((row) => {
      const details = JSON.parse(row.details_json) as DetailedProgramDiff;
      return {
        ...details,
        added: Number(row.added_count),
        modified: Number(row.modified_count),
        removed: Number(row.removed_count),
        total:
          Number(row.added_count) +
          Number(row.modified_count) +
          Number(row.removed_count),
        detectedAt: row.detected_at,
        previousFetchedAt: row.previous_fetched_at,
        currentFetchedAt: row.current_fetched_at,
      } satisfies StoredProgramChange;
    });
  } catch {
    return [];
  }
}
