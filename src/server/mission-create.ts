/**
 * Thin invocation wrapper around the existing authoritative
 * create-mission.js script (scripts/create-mission.js in the hermes repo).
 *
 * This is NOT a new persistence mechanism — it shells out to the same
 * script Axi's own session uses, so operations/missions/<ID>/00-intake.md
 * remains the single system of record. Mirrors the path-resolution
 * convention already established in operations-records.ts
 * (~/Documents/AI/hermes/...).
 *
 * Scope (STUDIO-025 amendment): creates a raw Intake record only. No
 * execution/dispatch capability of any kind lives here or is reachable
 * through this module.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const HERMES_ROOT = path.join(os.homedir(), 'Documents', 'AI', 'hermes')
const CREATE_MISSION_SCRIPT = path.join(HERMES_ROOT, 'scripts', 'create-mission.js')

export interface CreateMissionIntakeInput {
  title: string
  requestIntent: string
  confirmedBy: string
  originatingSurface?: string
}

export type CreateMissionResult =
  | { ok: true; missionId: string; path: string; intakeFile: string; createdAt: number }
  | { ok: false; error: string; existingMissionId?: string; message?: string }

/**
 * Build the full create-mission.js payload from the two minimal UI inputs
 * plus sane server-side defaults, then invoke the script and return its
 * parsed JSON result verbatim.
 */
export function createMissionIntake(input: CreateMissionIntakeInput): Promise<CreateMissionResult> {
  const payload = {
    prefix: 'STUDIO',
    title: input.title,
    originatingIdea: input.requestIntent,
    interpretedPurpose: 'To be refined by Axi during Intake processing.',
    desiredOutcome: 'To be refined by Axi during Intake processing.',
    confirmedBy: input.confirmedBy,
    confirmedAt: new Date().toISOString(),
    originatingSurface: input.originatingSurface ?? 'Hermes Studio — Missions page',
  }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CREATE_MISSION_SCRIPT, JSON.stringify(payload)],
      { timeout: 15_000 },
      (err, stdout) => {
        // create-mission.js always prints a JSON result to stdout, even on
        // its own validation failures (and exits non-zero in that case) —
        // so parse stdout first regardless of `err`, and only fall back to
        // a generic error if stdout itself isn't valid JSON (e.g. the
        // script crashed before printing, or node/the script path is bad).
        if (stdout) {
          try {
            resolve(JSON.parse(stdout.trim()) as CreateMissionResult)
            return
          } catch {
            /* fall through to generic error below */
          }
        }
        resolve({ ok: false, error: err ? err.message : 'create-mission.js produced no output' })
      },
    )
  })
}
