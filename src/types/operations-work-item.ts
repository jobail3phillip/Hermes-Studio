/**
 * Unified Operations work-item types — Intake / Missions / Repo Reviews / Software
 * Reviews, sourced from the real governance record on disk
 * (~/Documents/AI/hermes/operations/{missions,reviews}), not a parallel store.
 *
 * See STUDIO-017 (operations/missions/STUDIO-017/) and the STUDIO-016 Meridian
 * design artifact for the approved information architecture this mirrors.
 */

export type WorkItemType = 'mission' | 'repo-review' | 'sw-review' | 'intake'

/** Coarse phase bucket. NOTE: derived heuristically from filenames/content —
 * see known limitations in STUDIO-017 handoff. Not a distinct "awaiting-hfa"
 * vs "blocked" vs "active" split because the underlying markdown records have
 * no structured status field to distinguish those reliably. */
export type WorkItemPhase = 'needs-attention' | 'recently-closed' | 'historical'

export type GroupMode = 'phase' | 'type' | 'resource'

export interface WorkItem {
  id: string
  type: WorkItemType
  title: string
  phase: WorkItemPhase
  closed: boolean
  resource: string
  createdAt: string | null
  closedAt: string | null
  /** Path to the record dir, relative to the operations root — used for "open record". */
  recordPath: string
  /** Short excerpt for the detail panel narrative. */
  summary: string
}

export interface OperationsWorkItemsResponse {
  ok: boolean
  items: WorkItem[]
  source: {
    available: boolean
    missionsDir: string
    reviewsDir: string
    error?: string
  }
}
