/**
 * POST /api/missions/:missionId/disposition — thin wrapper that invokes the
 * existing authoritative scripts/disposition-mission.js to write a governed
 * closure/acceptance/hold record. No new persistence: the script writes a
 * numbered disposition markdown file directly into the existing
 * operations/missions/<ID>/ directory — the same corpus 00-intake.md
 * already lives in.
 *
 * Scope boundary (STUDIO-028): governance disposition only. This route must
 * never gain any CC/CX dispatch or execution-authority capability.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, getUserIdFromRequest } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { dispositionMission, type MissionDisposition } from '../../../server/mission-disposition'

const VALID_DISPOSITIONS: MissionDisposition[] = ['ACCEPTED_CLOSED', 'HELD']

export const Route = createFileRoute('/api/missions/$missionId/disposition')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

        const disposition = typeof body.disposition === 'string' ? body.disposition : ''
        if (!VALID_DISPOSITIONS.includes(disposition as MissionDisposition)) {
          return json(
            { ok: false, error: `disposition must be one of: ${VALID_DISPOSITIONS.join(', ')}` },
            { status: 400 },
          )
        }
        const result = typeof body.result === 'string' ? body.result.trim() : ''
        if (!result) {
          return json({ ok: false, error: 'result is required' }, { status: 400 })
        }

        // Same identity convention as POST /api/missions (mission-create.ts):
        // no display-name identity concept exists beyond opaque userId.
        const userId = getUserIdFromRequest(request)
        const authority = userId
          ? `Studio UI (${userId}, pending Axi Intake review)`
          : 'Studio UI (pending Axi Intake review)'

        const dispositionResult = await dispositionMission({
          missionId: params.missionId,
          disposition: disposition as MissionDisposition,
          authority,
          result,
        })

        if (!dispositionResult.ok) {
          const status = dispositionResult.error.startsWith('mission not found') ? 404 : 400
          return json(dispositionResult, { status })
        }
        return json(dispositionResult, { status: 201 })
      },
    },
  },
})
