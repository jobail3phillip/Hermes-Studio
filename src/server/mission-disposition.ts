/**
 * Thin invocation wrapper around the existing authoritative
 * disposition-mission.js script (scripts/disposition-mission.js in the
 * hermes repo) — the disposition-side sibling of mission-create.ts.
 *
 * NOT a new persistence mechanism: shells out to a script that writes a
 * numbered disposition markdown file (NN-*.md) into the existing
 * operations/missions/<ID>/ directory, following the exact field
 * conventions already present in the hand-authored corpus (see
 * STUDIO-024/01-hfa-acceptance.md, STUDIO-021/03-hold-status.md). No new
 * store, no new schema, no dispatch/execution capability reachable here.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const HERMES_ROOT = path.join(os.homedir(), 'Documents', 'AI', 'hermes')
const DISPOSITION_SCRIPT = path.join(HERMES_ROOT, 'scripts', 'disposition-mission.js')

// Vocabulary sourced from the existing on-disk governance corpus — do not
// add states here without a matching precedent in operations/missions/.
export type MissionDisposition = 'ACCEPTED_CLOSED' | 'HELD'

export interface DispositionMissionInput {
  missionId: string
  disposition: MissionDisposition
  authority: string
  result: string
}

export type DispositionMissionResult =
  | { ok: true; missionId: string; path: string; file: string; disposition: string }
  | { ok: false; error: string }

export function dispositionMission(input: DispositionMissionInput): Promise<DispositionMissionResult> {
  const payload = {
    missionId: input.missionId,
    disposition: input.disposition,
    authority: input.authority,
    result: input.result,
  }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [DISPOSITION_SCRIPT, JSON.stringify(payload)],
      { timeout: 15_000 },
      (err, stdout) => {
        // disposition-mission.js always prints JSON to stdout, even on its
        // own validation failures (non-zero exit) — parse stdout first
        // regardless of `err`, matching mission-create.ts's convention.
        if (stdout) {
          try {
            resolve(JSON.parse(stdout.trim()) as DispositionMissionResult)
            return
          } catch {
            /* fall through to generic error below */
          }
        }
        resolve({ ok: false, error: err ? err.message : 'disposition-mission.js produced no output' })
      },
    )
  })
}
