/**
 * Workflow store — file-backed persistence for DAG workflows.
 *
 * One workflow per crew. Stored in .runtime/workflows.json as a map of
 * crewId → Workflow. Follows the same pattern as crew-store.ts:
 * synchronous in-memory API with deferred disk writes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getStudioRuntimeDir } from './runtime-dir'
import type { Workflow, WorkflowTask, WorkflowEdge } from '../types/workflow'

const DATA_DIR = getStudioRuntimeDir()
const WORKFLOWS_FILE = join(DATA_DIR, 'workflows.json')

type StoreData = { workflows: Record<string, Workflow> }

let store: StoreData = { workflows: {} }

// ─── Disk persistence ────────────────────────────────────────────────────────

function loadFromDisk(): void {
  try {
    if (existsSync(WORKFLOWS_FILE)) {
      const raw = readFileSync(WORKFLOWS_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as StoreData
      if (parsed?.workflows && typeof parsed.workflows === 'object') {
        // Ensure x/y have defaults (guard against old data missing position fields)
        for (const wf of Object.values(parsed.workflows)) {
          wf.tasks = wf.tasks.map((t, i) => ({
            ...t,
            x: t.x ?? 80 + (i % 4) * 220,
            y: t.y ?? 80 + Math.floor(i / 4) * 120,
          }))
        }
        store = parsed
      }
    }
  } catch {
    // corrupt file — start fresh
  }
}

function saveToDisk(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(WORKFLOWS_FILE, JSON.stringify(store, null, 2))
  } catch {
    // ignore write failure — in-memory is still consistent
  }
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(): void {
  if (_saveTimer) return
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    saveToDisk()
  }, 1_000)
}

// Bootstrap on module load
loadFromDisk()

// ─── Public API ──────────────────────────────────────────────────────────────

export function getWorkflow(crewId: string): Workflow | null {
  return store.workflows[crewId] ?? null
}

export function upsertWorkflow(
  crewId: string,
  patch: { tasks: WorkflowTask[]; edges: WorkflowEdge[] },
): Workflow {
  const existing = store.workflows[crewId]
  const now = Date.now()
  const workflow: Workflow = existing
    ? { ...existing, tasks: patch.tasks, edges: patch.edges, updatedAt: now }
    : {
        id: randomUUID(),
        crewId,
        tasks: patch.tasks,
        edges: patch.edges,
        createdAt: now,
        updatedAt: now,
      }
  store.workflows[crewId] = workflow
  saveToDisk() // sync write on upsert — client may navigate away immediately
  return workflow
}

export function deleteWorkflow(crewId: string): boolean {
  if (!store.workflows[crewId]) return false
  delete store.workflows[crewId]
  saveToDisk()
  return true
}
