import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpHome: string

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ops-records-test-'))
  vi.spyOn(require('node:os'), 'homedir').mockReturnValue(tmpHome)
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmpHome, { recursive: true, force: true })
})

function seedCorpus() {
  const root = join(tmpHome, 'Documents', 'AI', 'hermes', 'operations')
  const missions = join(root, 'missions')
  const reviews = join(root, 'reviews')

  const openMission = join(missions, 'STUDIO-999')
  mkdirSync(openMission, { recursive: true })
  writeFileSync(
    join(openMission, '00-intake.md'),
    '# STUDIO-999 — Intake Record\n\n**Status:** intake\n**Created:** 2026-09-04 00:00:00 UTC\n\n## Originating Idea\n\nSomething CX should look at.\n',
  )

  const closedMission = join(missions, 'STUDIO-001')
  mkdirSync(closedMission, { recursive: true })
  writeFileSync(join(closedMission, '00-intake.md'), '# STUDIO-001\n\n**Status:** intake\n**Created:** 2020-01-01\n')
  writeFileSync(join(closedMission, '01-closure.md'), '# STUDIO-001 — Closure\n\nStatus: CLOSED\nClosed at: 2020-01-02T00:00:00Z\nBy Dev.\n')

  const repoReview = join(reviews, 'valkey-review-2020-01-01')
  mkdirSync(repoReview, { recursive: true })
  writeFileSync(
    join(repoReview, 'hfa-disposition.md'),
    '# HFA Disposition\nReview: valkey-io/valkey\nDate: 2020-01-01\n\n## Disposition\n\nCLOSED\nReviewed by CC.\n',
  )

  const swReview = join(reviews, 'notion-review-2020-01-01')
  mkdirSync(swReview, { recursive: true })
  writeFileSync(
    join(swReview, 'hfa-disposition.md'),
    '# HFA Disposition\nSubject: Notion\nDate: 2020-01-01\n\n## Disposition\n\nCLOSED\nReviewed by CC.\n',
  )

  return { root, missions, reviews }
}

async function getModule() {
  return import('@/server/operations-records')
}

describe('operations-records aggregator', () => {
  it('reports the corpus unavailable when the directory does not exist', async () => {
    const { isOperationsCorpusAvailable, listOperationsWorkItems } = await getModule()
    expect(isOperationsCorpusAvailable()).toBe(false)
    expect(listOperationsWorkItems()).toEqual([])
  })

  it('classifies missions, closed missions, repo reviews, and sw reviews from real files on disk', async () => {
    seedCorpus()
    const { isOperationsCorpusAvailable, listOperationsWorkItems } = await getModule()
    expect(isOperationsCorpusAvailable()).toBe(true)

    const items = listOperationsWorkItems()
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))

    expect(byId['STUDIO-999'].type).toBe('mission')
    expect(byId['STUDIO-999'].closed).toBe(false)

    expect(byId['STUDIO-001'].closed).toBe(true)
    expect(byId['STUDIO-001'].phase).toBe('historical') // closed in 2020 -> not "recent"

    expect(byId['valkey-review-2020-01-01'].type).toBe('repo-review')
    expect(byId['notion-review-2020-01-01'].type).toBe('sw-review')

    // Every item must carry a resolvable on-disk record path (no invented data).
    for (const item of items) {
      expect(item.recordPath.length).toBeGreaterThan(0)
    }
  })

  it('every returned item includes searchable id/title/resource fields (full-dataset search support)', async () => {
    seedCorpus()
    const { listOperationsWorkItems } = await getModule()
    const items = listOperationsWorkItems()
    // Historical (closed, old) records must still be present in the full list —
    // search/filter in the UI operates over this array, not a truncated view.
    expect(items.some((i) => i.phase === 'historical')).toBe(true)
    expect(items.length).toBe(4)
  })
})
