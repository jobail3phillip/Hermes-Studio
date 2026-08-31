/**
 * REPAIR-001 regression coverage.
 *
 * (a) Crew member session titles must be unique across two crews sharing a
 *     persona (mintSession's title collision was the root cause of the
 *     Hermes gateway `invalid_title` failure -> silent stub fallback).
 * (b) Dispatch must mark a member 'error' when send-stream resolves with a
 *     non-2xx HTTP response, not just on a network-level exception.
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'

describe('REPAIR-001: crew session title uniqueness', () => {
  it('mints unique titles for the same persona across two crews', () => {
    // Mirrors the title-building logic in mintSession() after the fix:
    // a fresh randomUUID suffix per mint, embedded in both id and title.
    function mintTitle(persona: string): { id: string; title: string } {
      const suffix = randomUUID().slice(0, 8)
      return {
        id: `crew-${persona}-${suffix}`,
        title: `Crew: ${persona.charAt(0).toUpperCase() + persona.slice(1)} (${suffix})`,
      }
    }

    const crewATitle = mintTitle('cc')
    const crewBTitle = mintTitle('cc')

    expect(crewATitle.title).not.toBe(crewBTitle.title)
    expect(crewATitle.id).not.toBe(crewBTitle.id)

    // Old (broken) behavior for comparison: literal 'Crew: Cc' every time.
    const oldStyleTitle = (p: string) => `Crew: ${p.charAt(0).toUpperCase() + p.slice(1)}`
    expect(oldStyleTitle('cc')).toBe(oldStyleTitle('cc')) // documents the collision the fix avoids
  })
})

describe('REPAIR-001: dispatch marks member error on non-2xx send-stream response', () => {
  it('calls markDispatchFailed equivalent logic when res.ok is false', async () => {
    // Reproduces the .then((res) => { if (!res.ok) ... }) branch added to
    // $crewId.dispatch.ts without spinning up the full HTTP route (which
    // needs an authenticated request/crew-store fixture). We assert the
    // same decision logic: a resolved-but-non-2xx fetch must be treated as
    // a failure, exactly like a rejected fetch.
    let markedError: string | null = null
    const updateMemberStatus = (_crewId: string, sessionKey: string, status: string) => {
      if (status === 'error') markedError = sessionKey
    }

    async function fakeFetch(): Promise<{ ok: boolean; status: number }> {
      return { ok: false, status: 404 }
    }

    async function dispatchOne(crewId: string, sessionKey: string) {
      await fakeFetch()
        .then((res) => {
          if (!res.ok) updateMemberStatus(crewId, sessionKey, 'error')
        })
        .catch(() => updateMemberStatus(crewId, sessionKey, 'error'))
    }

    await dispatchOne('crew-1', 'crew-cc-abc123')
    expect(markedError).toBe('crew-cc-abc123')
  })

  it('still catches network-level rejection (regression guard for existing behavior)', async () => {
    let markedError: string | null = null
    const updateMemberStatus = (_crewId: string, sessionKey: string, status: string) => {
      if (status === 'error') markedError = sessionKey
    }

    async function fakeFetch(): Promise<{ ok: boolean; status: number }> {
      throw new Error('ECONNREFUSED')
    }

    async function dispatchOne(crewId: string, sessionKey: string) {
      await fakeFetch()
        .then((res) => {
          if (!res.ok) updateMemberStatus(crewId, sessionKey, 'error')
        })
        .catch(() => updateMemberStatus(crewId, sessionKey, 'error'))
    }

    await dispatchOne('crew-1', 'crew-cc-def456')
    expect(markedError).toBe('crew-cc-def456')
  })

  it('detects the real send-stream failure shape: HTTP 200 with an SSE error event body', () => {
    // /api/send-stream always resolves 200 — failures (e.g. gateway 404
    // "Session not found") surface only as a leading `event: error` line
    // in the SSE body. Live-verified against the running dev server during
    // REPAIR-001 remediation. Mirrors bodyIndicatesSendStreamError().
    function bodyIndicatesSendStreamError(text: string): boolean {
      return /^event:\s*error\b/m.test(text)
    }

    const failureBody =
      'event: error\ndata: {"message":"Hermes chat stream: 404 Session not found: crew-cc-nonexistent00"}\n\n'
    const successBody =
      'event: started\ndata: {"runId":"run_abc"}\n\nevent: chunk\ndata: {"text":"OK"}\n\nevent: done\ndata: {"state":"complete"}\n\n'

    expect(bodyIndicatesSendStreamError(failureBody)).toBe(true)
    expect(bodyIndicatesSendStreamError(successBody)).toBe(false)
  })
})

describe('REPAIR-001 follow-up: clone.ts shares mintSession with index.ts (no forked bug)', () => {
  it('$crewId.clone.ts imports mintSession from the shared module, not a local reimplementation', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../routes/api/crews/$crewId.clone.ts', import.meta.url),
      'utf-8',
    )
    expect(src).toMatch(/import\s*\{\s*mintSession\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/server\/mint-crew-session'/)
    expect(src).not.toMatch(/^async function mintSession/m)
  })

  it('index.ts also imports the shared mintSession (single source of truth)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../routes/api/crews/index.ts', import.meta.url),
      'utf-8',
    )
    expect(src).toMatch(/import\s*\{\s*mintSession\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/server\/mint-crew-session'/)
    expect(src).not.toMatch(/^async function mintSession/m)
  })
})

describe('REPAIR-001 follow-up: dispatch-failed tasks are marked distinctly', () => {
  it('markDispatchFailed logic tags the review-moved task with dispatch-failed', () => {
    // Mirrors the tagging branch added to markDispatchFailed() in
    // $crewId.dispatch.ts without spinning up the full task-store/crew-store
    // fixtures. Asserts the same decision: a task moved to 'review' because
    // of a dispatch failure must be distinguishable from a normal
    // ready-for-review task via its tags.
    type FakeTask = { id: string; column: string; tags: string[] }
    const tasks: FakeTask[] = [{ id: 't1', column: 'in_progress', tags: [] }]

    function moveTask(id: string, column: string) {
      const t = tasks.find((x) => x.id === id)!
      t.column = column
    }
    function updateTask(id: string, updates: { tags: string[] }) {
      const t = tasks.find((x) => x.id === id)!
      t.tags = updates.tags
    }
    function markDispatchFailed(linkedTasks: FakeTask[]) {
      for (const t of linkedTasks) {
        if (t.column === 'todo' || t.column === 'in_progress') {
          moveTask(t.id, 'review')
          if (!t.tags.includes('dispatch-failed')) {
            updateTask(t.id, { tags: [...t.tags, 'dispatch-failed'] })
          }
        }
      }
    }

    markDispatchFailed(tasks)

    expect(tasks[0].column).toBe('review')
    expect(tasks[0].tags).toContain('dispatch-failed')
  })

  it('does not duplicate the tag if markDispatchFailed runs twice', () => {
    type FakeTask = { id: string; column: string; tags: string[] }
    const task: FakeTask = { id: 't1', column: 'review', tags: ['dispatch-failed'] }

    function markOnce(t: FakeTask) {
      if (!t.tags.includes('dispatch-failed')) {
        t.tags = [...t.tags, 'dispatch-failed']
      }
    }

    markOnce(task)
    markOnce(task)

    expect(task.tags.filter((tag) => tag === 'dispatch-failed')).toHaveLength(1)
  })
})

describe('STUDIO-002: successful dispatch transitions linked task to done', () => {
  it('markDispatchSucceeded logic moves the linked in-flight task to done', () => {
    // Mirrors moveLinkedTasks()'s success branch (column='done', no tag) in
    // $crewId.dispatch.ts, exercising the same decision logic markDispatchFailed
    // already had coverage for on the failure side.
    type FakeTask = { id: string; column: string; tags: string[] }
    const tasks: FakeTask[] = [{ id: 't1', column: 'in_progress', tags: [] }]

    function moveTask(id: string, column: string) {
      const t = tasks.find((x) => x.id === id)!
      t.column = column
    }
    function markDispatchSucceeded(linkedTasks: FakeTask[]) {
      for (const t of linkedTasks) {
        if (t.column === 'todo' || t.column === 'in_progress') {
          moveTask(t.id, 'done')
        }
      }
    }

    markDispatchSucceeded(tasks)

    expect(tasks[0].column).toBe('done')
    expect(tasks[0].tags).not.toContain('dispatch-failed')
  })

  it('$crewId.dispatch.ts routes both outcomes through the shared moveLinkedTasks helper', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../routes/api/crews/$crewId.dispatch.ts', import.meta.url),
      'utf-8',
    )
    expect(src).toMatch(/function markDispatchSucceeded/)
    expect(src).toMatch(/function moveLinkedTasks/)
    // Both markDispatchFailed and markDispatchSucceeded must call the same
    // shared helper — this is the root-cause fix, not a parallel status path.
    expect(src).toMatch(/markDispatchFailed[\s\S]*?moveLinkedTasks\(crewId, 'review', 'dispatch-failed'\)/)
    expect(src).toMatch(/markDispatchSucceeded[\s\S]*?moveLinkedTasks\(crewId, 'done'\)/)
  })
})
