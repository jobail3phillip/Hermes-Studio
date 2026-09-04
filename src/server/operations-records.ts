/**
 * Operations records aggregator — reads the REAL governed mission/review
 * corpus on disk (~/Documents/AI/hermes/operations/{missions,reviews}) and
 * projects it into the unified WorkItem shape the Operations page renders.
 *
 * This is intentionally a read-only projection, not a new persistence
 * mechanism: the markdown files under operations/ remain the system of
 * record. See STUDIO-017 implementation requirements + the STUDIO-016
 * design-rationale.md "Data model" note — a unified structured index across
 * Mission/Review/Intake records does not exist upstream today, so this
 * aggregator derives phase/type/resource with documented heuristics rather
 * than inventing new schema/persistence for the governance corpus (out of
 * scope per STUDIO-017 boundaries — "do not silently alter schemas").
 *
 * ponytail: heuristic classification (see classifyItem/extractResource) is a
 * best-effort read of free-form markdown, not a real status enum. Upgrade
 * path: if/when the governance corpus adopts structured frontmatter
 * (status/type/resource fields), replace the regex heuristics below with a
 * direct field read.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WorkItem, WorkItemPhase, WorkItemType } from '../types/operations-work-item'

function operationsRoot(): string {
  return path.join(os.homedir(), 'Documents', 'AI', 'hermes', 'operations')
}
function missionsDir(): string { return path.join(operationsRoot(), 'missions') }
function reviewsDir(): string { return path.join(operationsRoot(), 'reviews') }

const RECENT_MS = 30 * 24 * 60 * 60 * 1000
const CLOSED_FILENAME_RE = /closure|closeout|closed|disposition|final.*decision/i
const ACTORS = ['Axi', 'CC', 'CX', 'Dev', 'Atlas', 'Meridian', 'Runner', 'JP', 'Warp', 'Codex']

function readDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function readFilesConcat(dir: string, maxBytes = 20_000): { text: string; files: string[] } {
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md') || f.toLowerCase().endsWith('.json'))
  } catch {
    return { text: '', files: [] }
  }
  let text = ''
  for (const f of files) {
    if (text.length >= maxBytes) break
    try {
      text += '\n' + fs.readFileSync(path.join(dir, f), 'utf-8').slice(0, maxBytes)
    } catch {
      /* unreadable file — skip */
    }
  }
  return { text, files }
}

function extractResource(text: string): string {
  for (const actor of ACTORS) {
    if (new RegExp(`\\b${actor}\\b`).test(text)) return actor
  }
  return 'Unassigned'
}

function extractDate(text: string): string | null {
  const m = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  return m ? m[1] : null
}

function extractSummary(text: string): string {
  const idea = text.match(/## (?:Originating Idea|Interpreted Purpose)\s*\n\n([\s\S]{0,400}?)(\n\n|$)/)
  if (idea) return idea[1].trim().slice(0, 300)
  const firstPara = text.replace(/^#.*$/m, '').trim().split(/\n\n/)[0] ?? ''
  return firstPara.slice(0, 300)
}

function computePhase(closed: boolean, referenceDate: string | null): WorkItemPhase {
  const ts = referenceDate ? Date.parse(referenceDate) : NaN
  const recent = !Number.isNaN(ts) && Date.now() - ts < RECENT_MS
  if (closed) return recent ? 'recently-closed' : 'historical'
  return recent ? 'needs-attention' : 'historical'
}

function classifyMission(id: string, dir: string): WorkItem {
  const { text, files } = readFilesConcat(dir)
  const closed = files.some((f) => CLOSED_FILENAME_RE.test(f)) || /status:\**\s*closed/i.test(text)
  const statusLine = text.match(/\*\*Status:\*\*\s*(.+)/)
  const isRawIntake = files.length === 1 && files[0] === '00-intake.md' && /status:\s*intake/i.test(text) && !closed
  const type: WorkItemType = isRawIntake ? 'intake' : 'mission'
  const createdAt = extractDate(text)
  const closedAt = closed ? extractDate(text.split(/status:\**\s*closed/i)[1] ?? text) ?? createdAt : null
  return {
    id,
    type,
    title: id,
    phase: computePhase(closed, closed ? closedAt : createdAt),
    closed,
    resource: extractResource(text),
    createdAt,
    closedAt,
    recordPath: path.relative(operationsRoot(), dir),
    summary: statusLine ? `${statusLine[1].trim()} — ${extractSummary(text)}` : extractSummary(text),
  }
}

function classifyReview(id: string, dir: string): WorkItem {
  const { text } = readFilesConcat(dir)
  // Heuristic: "owner/repo" shaped subject line -> repository review; otherwise software review.
  const isRepoShaped = /Review:\s*[\w.-]+\/[\w.-]+/.test(text)
  const type: WorkItemType = isRepoShaped ? 'repo-review' : 'sw-review'
  const closed = /closed/i.test(text)
  const createdAt = extractDate(text)
  return {
    id,
    type,
    title: id.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-/g, ' '),
    phase: computePhase(closed, createdAt),
    closed,
    resource: extractResource(text),
    createdAt,
    closedAt: closed ? createdAt : null,
    recordPath: path.relative(operationsRoot(), dir),
    summary: extractSummary(text),
  }
}

export function isOperationsCorpusAvailable(): boolean {
  return fs.existsSync(missionsDir()) || fs.existsSync(reviewsDir())
}

export function listOperationsWorkItems(): WorkItem[] {
  const items: WorkItem[] = []
  for (const id of readDirSafe(missionsDir())) {
    items.push(classifyMission(id, path.join(missionsDir(), id)))
  }
  for (const id of readDirSafe(reviewsDir())) {
    items.push(classifyReview(id, path.join(reviewsDir(), id)))
  }
  return items
}

export function operationsPaths(): { missionsDir: string; reviewsDir: string } {
  return { missionsDir: missionsDir(), reviewsDir: reviewsDir() }
}
