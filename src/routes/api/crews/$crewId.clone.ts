/**
 * POST /api/crews/:crewId/clone
 *
 * Duplicates an existing crew — mints fresh sessions for every member and
 * saves the new crew as "Copy of <original name>" in draft status.
 *
 * Response:
 *   { ok: true, crew: Crew }
 *
 * Inspired by xaspx/hermes-control-interface + karmsheel/mission-control-hermes
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { getCrew, createCrew } from '../../../server/crew-store'
import { mintSession } from '../../../server/mint-crew-session'

export const Route = createFileRoute('/api/crews/$crewId/clone')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const source = getCrew(params.crewId)
        if (!source) {
          return json({ ok: false, error: 'Crew not found' }, { status: 404 })
        }

        // Mint fresh sessions for every member in parallel. A failed
        // real-session mint for a non-advisory member is a hard failure for
        // the whole clone — Promise.all rejects and we surface it below
        // rather than cloning a crew with a member that can never actually
        // be dispatched to (same contract as POST /api/crews).
        let members: Array<{
          sessionKey: string
          role: (typeof source.members)[number]['role']
          persona: string
          displayName: string
          roleLabel: string
          color: string
          model: string | null
          profileName: string | null
          advisory: boolean
        }>
        try {
          members = await Promise.all(
            source.members.map(async (m) => {
              const personaForSession = m.displayName
                .replace(/^[^\s]+\s*/, '')  // strip leading emoji+space
                .toLowerCase()
              const advisory = m.advisory === true
              const sessionKey = await mintSession(
                personaForSession || m.persona,
                m.model,
                advisory,
              )
              return {
                sessionKey,
                role: m.role,
                persona: m.persona,
                displayName: m.displayName,
                roleLabel: m.roleLabel,
                color: m.color,
                model: m.model,
                profileName: m.profileName,
                advisory,
              }
            }),
          )
        } catch (err) {
          return json(
            {
              ok: false,
              error:
                err instanceof Error
                  ? err.message
                  : 'Failed to mint a real runtime session for a crew member',
            },
            { status: 502 },
          )
        }

        const crew = createCrew({
          name: `Copy of ${source.name}`,
          goal: source.goal,
          members,
        })

        return json({ ok: true, crew }, { status: 201 })
      },
    },
  },
})
