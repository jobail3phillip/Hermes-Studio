/**
 * GET  /api/crews        — list all crews
 * POST /api/crews        — create a crew (mints sessions for each member)
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { listAgents } from '../../../server/agent-definitions-store'
import {
  createCrew,
  listCrews,
} from '../../../server/crew-store'
import { mintSession } from '../../../server/mint-crew-session'

export const Route = createFileRoute('/api/crews/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, crews: listCrews() })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >

        const name =
          typeof body.name === 'string' ? body.name.trim() : ''
        const goal =
          typeof body.goal === 'string' ? body.goal.trim() : ''

        if (!name) {
          return json({ ok: false, error: 'name is required' }, { status: 400 })
        }

        const rawMembers = Array.isArray(body.members) ? body.members : []
        if (rawMembers.length === 0) {
          return json(
            { ok: false, error: 'at least one member is required' },
            { status: 400 },
          )
        }
        if (rawMembers.length > 8) {
          return json(
            { ok: false, error: 'maximum 8 members per crew' },
            { status: 400 },
          )
        }

        // Load all agents (built-ins + custom, workspace-scoped) for lookup
        const allAgents = listAgents()
        const fallback = allAgents.find((a) => a.isBuiltIn) ?? allAgents[0]

        // Build members, minting sessions in parallel.
        // A failed real-session mint for a non-advisory member is a hard
        // failure for the whole create — Promise.all rejects and we surface
        // it below rather than creating a crew with a member that can never
        // actually be dispatched to.
        let members: Array<{
          sessionKey: string
          role: import('../../../server/crew-store').CrewMemberRole
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
            (rawMembers as Array<Record<string, unknown>>).map(async (m) => {
              const personaName =
                typeof m.persona === 'string' ? m.persona.toLowerCase() : fallback?.name.toLowerCase() ?? ''

              // Try custom/built-in agent lookup first, fall back to default builtin
              const agentDef = allAgents.find(
                (a) => a.name.toLowerCase() === personaName,
              ) ?? fallback
              const displayEmoji = agentDef?.emoji ?? '🤖'
              const displayName = agentDef?.name ?? personaName
              const roleLabel = agentDef?.roleLabel ?? 'Agent'
              const color = agentDef?.color ?? 'text-blue-400'

              const model =
                agentDef?.model ??
                (typeof m.model === 'string' && m.model ? m.model : null)
              const role =
                typeof m.role === 'string' ? m.role : 'executor'
              const advisory = agentDef?.advisory === true

              const sessionKey = await mintSession(displayName.toLowerCase(), model, advisory)
              const profileName =
                typeof m.profileName === 'string' && m.profileName
                  ? m.profileName
                  : null

              return {
                sessionKey,
                role: role as import('../../../server/crew-store').CrewMemberRole,
                persona: personaName,
                displayName: `${displayEmoji} ${displayName}`,
                roleLabel,
                color,
                model,
                profileName,
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

        const crew = createCrew({ name, goal, members })
        return json({ ok: true, crew }, { status: 201 })
      },
    },
  },
})
