/**
 * Shared session-minting logic for crew members — used by both crew create
 * (POST /api/crews) and crew clone (POST /api/crews/:id/clone).
 *
 * Extracted after REPAIR-001 CX review found clone's own forked copy of this
 * function still running the pre-fix logic (duplicate titles, silent stub
 * fallback for non-advisory members) — same root cause, second caller.
 * One shared implementation so this can't recur a third time.
 */
import { randomUUID } from 'node:crypto'
import {
  ensureGatewayProbed,
  getGatewayCapabilities,
  createSession,
} from './hermes-api'
import { ensureLocalSession, toLocalSessionSummary } from './local-session-store'

/**
 * Mint a session for a crew member.
 * Works in both enhanced-hermes and portable/local modes.
 *
 * Non-advisory (executable) members MUST get a real Hermes gateway session —
 * they have a live dispatch path and a local stub is never actually invoked.
 * If gateway session creation fails for one of these, this throws instead of
 * silently falling back, so the caller can surface the failure.
 *
 * Advisory members (e.g. Atlas/GPT) have no live dispatch path either way,
 * so they may keep using the local/stub fallback.
 */
export async function mintSession(
  persona: string,
  model: string | null,
  advisory: boolean,
): Promise<string> {
  // Unique id/title suffix — randomUUID slice already guarantees a unique
  // id; reuse the SAME suffix in the title too, since the gateway rejects
  // duplicate *titles* (`invalid_title`) independently of session id.
  const suffix = randomUUID().slice(0, 8)
  const friendlyId = `crew-${persona}-${suffix}`

  await ensureGatewayProbed()
  if (getGatewayCapabilities().sessions) {
    try {
      const session = await createSession({
        id: friendlyId,
        title: `Crew: ${persona.charAt(0).toUpperCase() + persona.slice(1)} (${suffix})`,
        model: model ?? undefined,
      })
      return session.id
    } catch (err) {
      if (!advisory) {
        // Executable member with no real runtime session — hard failure,
        // do not silently hand it a Studio-only stub it can never dispatch to.
        throw new Error(
          `Failed to mint real Hermes session for non-advisory persona "${persona}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      // Advisory member — fall through to local stub below.
    }
  }

  // Local fallback (advisory members, or gateway sessions API unavailable)
  const local = ensureLocalSession(friendlyId, model ?? undefined)
  void toLocalSessionSummary(local)
  return local.id
}
