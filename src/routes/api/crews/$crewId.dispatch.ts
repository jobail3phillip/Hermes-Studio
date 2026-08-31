/**
 * POST /api/crews/:crewId/dispatch
 *
 * Dispatches a task prompt to one or more crew members by POSTing to
 * /api/send-stream for each targeted session. The send-stream handler
 * runs the agent and emits events back to any SSE subscribers — the
 * crew detail UI picks these up via /api/chat-events automatically.
 *
 * Body:
 *   { task: string, target: 'all' | <memberId> }
 *
 * Response:
 *   { ok: true, dispatched: string[] }   — list of sessionKeys dispatched
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  getCrew,
  updateCrew,
  updateMemberStatus,
} from '../../../server/crew-store'
import { listTasks, moveTask, updateTask } from '../../../server/task-store'

/**
 * Mark a crew member as failed after a dispatch attempt to /api/send-stream
 * didn't actually reach the real runtime (network error or non-2xx HTTP
 * response). If a Studio task is linked to this crew (sourceType='crew',
 * sourceId=crewId) and still mid-flight, move it to 'review' so a human/Axi
 * notices instead of it silently staying "in_progress" forever.
 *
 * The moved task also gets a 'dispatch-failed' tag so it's visibly distinct
 * in the review column from a normal "ready for human review" task — CX
 * flagged that these were otherwise indistinguishable. Reuses the existing
 * `tags` field rather than adding a schema field.
 * ponytail: moves ALL in_progress/todo tasks linked to the crew, not just
 * the one for this specific member — crew-store has no per-member task
 * linkage today. Fine for the current 1-task-per-crew-dispatch usage;
 * revisit if/when a crew can have multiple concurrently-dispatched tasks.
 */
function markDispatchFailed(crewId: string, sessionKey: string): void {
  moveLinkedTasks(crewId, 'review', 'dispatch-failed')
  updateMemberStatus(crewId, sessionKey, 'error')
}

/**
 * Mark a crew member 'done' after a dispatch attempt to /api/send-stream
 * actually completed successfully (2xx response, no SSE `event: error`
 * marker in the body). Mirrors markDispatchFailed: moves any linked,
 * still-in-flight Studio task ('todo'/'in_progress') to the 'done' column —
 * same store, same linkage, just the success side of the transition that
 * only the failure path previously implemented.
 */
function markDispatchSucceeded(crewId: string, sessionKey: string): void {
  moveLinkedTasks(crewId, 'done')
  updateMemberStatus(crewId, sessionKey, 'done')
}

/**
 * Shared status-transition helper for both the success and failure dispatch
 * outcomes. Moves every Studio task linked to this crew (sourceType='crew',
 * sourceId=crewId) that's still mid-flight ('todo'/'in_progress') into the
 * given target column, optionally tagging it (used by the failure path to
 * flag 'dispatch-failed' distinctly from a normal review-ready task).
 * ponytail: moves ALL in_progress/todo tasks linked to the crew, not just
 * the one for this specific member — crew-store has no per-member task
 * linkage today. Fine for the current 1-task-per-crew-dispatch usage;
 * revisit if/when a crew can have multiple concurrently-dispatched tasks.
 */
function moveLinkedTasks(crewId: string, column: 'review' | 'done', tag?: string): void {
  const linkedTasks = listTasks({ sourceType: 'crew', sourceId: crewId })
  for (const t of linkedTasks) {
    if (t.column === 'todo' || t.column === 'in_progress') {
      moveTask(t.id, column)
      if (tag && !t.tags.includes(tag)) {
        updateTask(t.id, { tags: [...t.tags, tag] })
      }
    }
  }
}

/**
 * /api/send-stream ALWAYS resolves with HTTP 200, even on failure (e.g. a
 * gateway 404 "Session not found") — the underlying error is only visible
 * as a leading `event: error` line in its SSE-formatted response body. So
 * on top of the res.ok / network-exception checks below, a 200 response
 * body must also be scanned for that marker; otherwise this exact class of
 * failure (the root cause the original bug report reproduced) would still
 * slip through and leave the member falsely "running".
 */
function bodyIndicatesSendStreamError(text: string): boolean {
  return /^event:\s*error\b/m.test(text)
}

export const Route = createFileRoute('/api/crews/$crewId/dispatch')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const crew = getCrew(params.crewId)
        if (!crew) {
          return json({ ok: false, error: 'Crew not found' }, { status: 404 })
        }

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >

        const task = typeof body.task === 'string' ? body.task.trim() : ''
        if (!task) {
          return json({ ok: false, error: 'task is required' }, { status: 400 })
        }

        // Determine which members to target
        const target = body.target ?? 'all'
        const targets =
          target === 'all'
            ? crew.members
            : crew.members.filter((m) => m.id === target || m.sessionKey === target)

        if (targets.length === 0) {
          return json(
            { ok: false, error: 'no matching members found' },
            { status: 400 },
          )
        }

        // Advisory-only members (e.g. GPT/Atlas) have no live dispatch path.
        // Route them out honestly instead of pretending they were invoked.
        const advisoryTargets = targets.filter((m) => m.advisory === true)
        const dispatchableTargets = targets.filter((m) => m.advisory !== true)

        if (dispatchableTargets.length === 0) {
          return json(
            {
              ok: false,
              error:
                'All targeted members are advisory-only (e.g. GPT/Atlas) and have no live dispatch path. Hand this task off manually.',
              advisoryOnly: advisoryTargets.map((m) => m.sessionKey),
            },
            { status: 422 },
          )
        }

        const origin = new URL(request.url).origin

        // Mark crew as active and all dispatchable members as running.
        // Advisory members are left untouched (no status change, no fake "running").
        updateCrew(params.crewId, { status: 'active' })
        for (const member of dispatchableTargets) {
          updateMemberStatus(params.crewId, member.sessionKey, 'running')
        }

        // Fire-and-forget — POST to send-stream for each real target.
        // We don't await these because send-stream is a long-running SSE response.
        // The frontend subscribes to /api/chat-events and watches for run events.
        const dispatched: string[] = []
        for (const member of dispatchableTargets) {
          dispatched.push(member.sessionKey)
          const crewId = params.crewId
          // Non-streaming fire-and-forget to kick off the agent run
          void fetch(`${origin}/api/send-stream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Forward auth cookie if present
              cookie: request.headers.get('cookie') ?? '',
            },
            body: JSON.stringify({
              message: task,
              sessionKey: member.sessionKey,
              model: member.model ?? undefined,
              stream: false,  // don't need the stream here — events flow via chat-event-bus
            }),
          })
            .then(async (res) => {
              if (!res.ok) {
                // HTTP-level failure (rare — send-stream normally returns 200
                // even on failure; kept as a belt-and-suspenders check).
                markDispatchFailed(crewId, member.sessionKey)
                return
              }
              // send-stream returns HTTP 200 with an SSE-formatted body even
              // when the underlying run failed (e.g. gateway 404 "Session
              // not found") — inspect the body for a leading error event.
              const text = await res.text().catch(() => '')
              if (bodyIndicatesSendStreamError(text)) {
                markDispatchFailed(crewId, member.sessionKey)
              } else {
                markDispatchSucceeded(crewId, member.sessionKey)
              }
            })
            .catch(() => {
              // Network-level failure (e.g. connection refused)
              markDispatchFailed(crewId, member.sessionKey)
            })
        }

        return json({
          ok: true,
          dispatched,
          crewId: params.crewId,
          ...(advisoryTargets.length > 0
            ? {
                skippedAdvisory: advisoryTargets.map((m) => m.sessionKey),
                note: 'Advisory-only members were skipped — no live dispatch path (manual handoff required).',
              }
            : {}),
        })
      },
    },
  },
})
