/**
 * Cost store — file-backed persistence for per-crew token usage and cost estimates.
 *
 * Token data is pulled from the Hermes session API after each run completes.
 * Records are cumulative per session key (matching how Hermes accumulates tokens).
 * Stored in .runtime/costs.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CrewUsage, CostStoreData } from '../types/cost'
import { getStudioRuntimeDir } from './runtime-dir'
import { getActiveProfileName } from './profiles-browser'

function dataDir(): string { return getStudioRuntimeDir() }
function costsFile(): string { return join(dataDir(), 'costs.json') }

// ─── Price table ($ per 1M tokens, as of April 2026) ─────────────────────────

const PRICE_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> =
  {
    // Anthropic
    'claude-opus-4-6':   { inputPer1M: 15.0,  outputPer1M: 75.0 },
    'claude-opus-4-5':   { inputPer1M: 15.0,  outputPer1M: 75.0 },
    'claude-sonnet-4-6': { inputPer1M:  3.0,  outputPer1M: 15.0 },
    'claude-sonnet-4-5': { inputPer1M:  3.0,  outputPer1M: 15.0 },
    'claude-sonnet-4':   { inputPer1M:  3.0,  outputPer1M: 15.0 },
    'claude-haiku-4-5':  { inputPer1M:  0.8,  outputPer1M:  4.0 },
    'claude-haiku-3.5':  { inputPer1M:  0.8,  outputPer1M:  4.0 },
    'claude-3-5-sonnet': { inputPer1M:  3.0,  outputPer1M: 15.0 },
    'claude-3-opus':     { inputPer1M: 15.0,  outputPer1M: 75.0 },
    // OpenAI
    'gpt-4.1':           { inputPer1M:  2.0,  outputPer1M:  8.0 },
    'gpt-4.1-mini':      { inputPer1M:  0.4,  outputPer1M:  1.6 },
    'gpt-4o':            { inputPer1M:  2.5,  outputPer1M: 10.0 },
    'gpt-4o-mini':       { inputPer1M:  0.15, outputPer1M:  0.6 },
    'gpt-4-turbo':       { inputPer1M: 10.0,  outputPer1M: 30.0 },
    'o1':                { inputPer1M: 15.0,  outputPer1M: 60.0 },
    'o3-mini':           { inputPer1M:  1.1,  outputPer1M:  4.4 },
    // Google
    'gemini-2.5-pro':    { inputPer1M:  1.25, outputPer1M:  5.0 },
    'gemini-2.5-flash':  { inputPer1M:  0.15, outputPer1M:  0.6 },
    'gemini-2.0-flash':  { inputPer1M:  0.075, outputPer1M: 0.3 },
    // Fallback
    __unknown__:         { inputPer1M:  1.0,  outputPer1M:  5.0 },
  }

function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): number {
  let rates = PRICE_TABLE['__unknown__']
  if (model) {
    const lower = model.toLowerCase()
    if (PRICE_TABLE[lower]) {
      rates = PRICE_TABLE[lower]
    } else {
      // Fuzzy match — find the first key that is a substring of the model string
      for (const [key, value] of Object.entries(PRICE_TABLE)) {
        if (key === '__unknown__') continue
        if (lower.includes(key) || key.includes(lower)) {
          rates = value
          break
        }
      }
    }
  }
  const cost =
    (inputTokens / 1_000_000) * rates.inputPer1M +
    (outputTokens / 1_000_000) * rates.outputPer1M
  return Math.round(cost * 1_000_000) / 1_000_000
}

// ─── Disk persistence ─────────────────────────────────────────────────────────

let store: CostStoreData = { crews: {} }

function loadFromDisk(): void {
  try {
    const file = costsFile()
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw) as CostStoreData
      if (parsed?.crews && typeof parsed.crews === 'object') {
        store = parsed
      }
    }
  } catch {
    // corrupt file — start fresh
  }
}

function saveToDisk(): void {
  try {
    const dir = dataDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(costsFile(), JSON.stringify(store, null, 2))
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

let loadedForProfile: string | null = null
function ensureLoaded(): void {
  const active = getActiveProfileName()
  if (active === loadedForProfile) return
  store = { crews: {} }
  loadFromDisk()
  loadedForProfile = active
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getCrewUsage(crewId: string): CrewUsage | null {
  ensureLoaded()
  return store.crews[crewId] ?? null
}

/**
 * Upserts a member's cumulative token counts for a crew.
 * Token values are the current session totals (not deltas).
 * Re-derives crew-level totals from all member records.
 */
export function recordMemberUsage(
  crewId: string,
  sessionKey: string,
  displayName: string,
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): CrewUsage {
  ensureLoaded()
  const existing = store.crews[crewId] ?? {
    crewId,
    members: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEstimatedCostUsd: 0,
    lastUpdatedAt: Date.now(),
  }

  existing.members[sessionKey] = {
    sessionKey,
    displayName,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    lastUpdatedAt: Date.now(),
  }

  // Re-derive totals
  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0
  for (const m of Object.values(existing.members)) {
    totalInput += m.inputTokens
    totalOutput += m.outputTokens
    totalCost += m.estimatedCostUsd
  }
  existing.totalInputTokens = totalInput
  existing.totalOutputTokens = totalOutput
  existing.totalEstimatedCostUsd = Math.round(totalCost * 1_000_000) / 1_000_000
  existing.lastUpdatedAt = Date.now()

  store.crews[crewId] = existing
  scheduleSave()
  return existing
}

export function resetCrewUsage(crewId: string): void {
  ensureLoaded()
  delete store.crews[crewId]
  scheduleSave()
}

export function deleteCrewUsage(crewId: string): void {
  ensureLoaded()
  delete store.crews[crewId]
  saveToDisk()
}
