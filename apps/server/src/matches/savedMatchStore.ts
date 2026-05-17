import type { MatchState } from "@ward/shared";
import { normalizeMatch } from "@ward/engine";

import type { SavedMatchSummary } from "../dataStore.js";
import { validateSavedMatchId } from "../dataStore.js";
import { getDbPool } from "../db/pool.js";

type SavedMatchRow = {
  match_id: string;
  match_state?: MatchState | string;
  format: string;
  turn_number: number;
  turn_cycle_number: number;
  active_player_id: string;
  phase: string;
  updated_at: Date | string;
};

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeSummary(row: SavedMatchRow): SavedMatchSummary {
  return {
    matchId: row.match_id,
    format: row.format,
    turnNumber: Number(row.turn_number),
    turnCycleNumber: Number(row.turn_cycle_number),
    activePlayerId: row.active_player_id,
    phase: row.phase,
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function parseMatchState(value: MatchState | string | undefined): MatchState {
  if (!value) {
    throw new Error("Saved match is missing match state.");
  }

  return normalizeMatch(
    typeof value === "string" ? JSON.parse(value) as MatchState : value
  );
}

export async function saveSavedMatch(match: MatchState): Promise<void> {
  const normalizedMatch = normalizeMatch(match);
  validateSavedMatchId(normalizedMatch.matchId);

  await getDbPool().query(
    `insert into saved_matches (
       match_id,
       match_state,
       format,
       turn_number,
       turn_cycle_number,
       active_player_id,
       phase
     )
     values ($1,$2::jsonb,$3,$4,$5,$6,$7)
     on conflict (match_id) do update set
       match_state = excluded.match_state,
       format = excluded.format,
       turn_number = excluded.turn_number,
       turn_cycle_number = excluded.turn_cycle_number,
       active_player_id = excluded.active_player_id,
       phase = excluded.phase,
       updated_at = now()`,
    [
      normalizedMatch.matchId,
      JSON.stringify(normalizedMatch),
      normalizedMatch.format,
      normalizedMatch.turn.turnNumber,
      normalizedMatch.turn.turnCycleNumber,
      normalizedMatch.turn.activePlayerId,
      normalizedMatch.turn.phase
    ]
  );
}

export async function listSavedMatchesFromDb(): Promise<SavedMatchSummary[]> {
  const result = await getDbPool().query<SavedMatchRow>(
    `select match_id,
            format,
            turn_number,
            turn_cycle_number,
            active_player_id,
            phase,
            updated_at
       from saved_matches
      order by updated_at desc`
  );

  return result.rows.map(serializeSummary);
}

export async function loadSavedMatchFromDb(matchId: string): Promise<MatchState | undefined> {
  validateSavedMatchId(matchId);

  const result = await getDbPool().query<SavedMatchRow>(
    `select match_state,
            match_id,
            format,
            turn_number,
            turn_cycle_number,
            active_player_id,
            phase,
            updated_at
       from saved_matches
      where match_id = $1`,
    [matchId]
  );

  return result.rows[0] ? parseMatchState(result.rows[0].match_state) : undefined;
}

export async function deleteSavedMatchFromDb(matchId: string): Promise<boolean> {
  validateSavedMatchId(matchId);

  const result = await getDbPool().query(
    "delete from saved_matches where match_id = $1",
    [matchId]
  );

  return Number(result.rowCount ?? 0) > 0;
}
