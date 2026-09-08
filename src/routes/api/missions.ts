/**
 * POST /api/missions — thin wrapper that invokes the existing authoritative
 * scripts/create-mission.js to create a raw Intake record. No new
 * persistence: the script itself writes operations/missions/<ID>/00-intake.md,
 * this route only translates the minimal Studio UI inputs (title +
 * request/intent) into its payload and returns the result.
 *
 * Scope boundary (STUDIO-025): Intake creation only. This route must never
 * gain any CC/CX dispatch or execution-authority capability.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, getUserIdFromRequest } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { createMissionIntake } from '../../server/mission-create'

export const Route = createFileRoute('/api/missions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

        const title = typeof body.title === 'string' ? body.title.trim() : ''
        const requestIntent = typeof body.requestIntent === 'string' ? body.requestIntent.trim() : ''
        if (!title || !requestIntent) {
          return json({ ok: false, error: 'title and requestIntent are required' }, { status: 400 })
        }

        // No authenticated-user identity concept exists in this codebase
        // beyond an opaque session->userId mapping (auth-middleware.ts) that
        // is not a display name; clearly label the actor rather than
        // fabricate an HFA attribution the UI has no authority to assert.
        const userId = getUserIdFromRequest(request)
        const confirmedBy = userId ? `Studio UI (${userId}, pending Axi Intake review)` : 'Studio UI (pending Axi Intake review)'

        const result = await createMissionIntake({ title, requestIntent, confirmedBy })

        if (!result.ok) {
          const status = result.error === 'duplicate_title' ? 409 : 400
          return json(result, { status })
        }
        return json(result, { status: 201 })
      },
    },
  },
})
