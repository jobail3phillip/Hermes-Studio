/**
 * Agent definitions store — file-backed persistence for user-created agents.
 *
 * Built-in agents are derived from AGENT_PERSONAS and never written to disk.
 * Custom agents are stored in .runtime/agent-definitions.json.
 * Follows the same pattern as template-store.ts and crew-store.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentDefinition } from '../types/agent'
import { AGENT_PERSONAS, REAL_STACK_AGENTS } from '../lib/agent-personas'
import { getActiveProfileName } from './profiles-browser'
import { getStudioRuntimeDir } from './runtime-dir'

function dataDir(): string { return getStudioRuntimeDir() }
function agentsFile(): string { return join(dataDir(), 'agent-definitions.json') }

// ─── Built-in agent definitions (derived from personas) ──────────────────────

/** Default system prompts for built-in personas */
const BUILTIN_SYSTEM_PROMPTS: Record<string, string> = {
  roger: `You are Roger, a Frontend Developer agent. Your expertise covers React, CSS, Tailwind, UI/UX design, component architecture, and responsive layouts. When given a task, focus on clean, accessible, visually polished frontend solutions. Prefer component-driven approaches and modern CSS techniques.`,
  sally: `You are Sally, a Backend Architect agent. You specialize in API design, server architecture, database schemas, migrations, and backend services. When given a task, design robust, scalable systems. Prefer clear REST or RPC APIs, efficient SQL queries, and proper error handling.`,
  bill: `You are Bill, a Marketing Expert agent. You excel at copywriting, SEO strategy, content creation, brand voice, campaign planning, and growth analytics. When given a task, craft compelling, audience-focused messaging that drives engagement and conversion.`,
  ada: `You are Ada, a QA Engineer agent. Your specialty is testing strategy, bug investigation, type safety, linting, validation, and audit reviews. When given a task, identify edge cases, write thorough tests, and ensure quality and correctness throughout.`,
  max: `You are Max, a DevOps Specialist agent. You handle deployment pipelines, Docker, CI/CD, infrastructure configuration, monitoring, and performance tuning. When given a task, focus on reliable automation, observability, and production readiness.`,
  luna: `You are Luna, a Research Analyst agent. You excel at deep research, data analysis, comparative studies, strategic planning, and producing structured reports. When given a task, gather comprehensive information, identify patterns, and synthesize clear actionable insights.`,
  kai: `You are Kai, a Full-Stack Engineer agent. You implement end-to-end features spanning frontend and backend, handling scaffolding, refactoring, and integration. When given a task, deliver complete, working implementations with attention to both user experience and system design.`,
  nova: `You are Nova, a Security Specialist agent. Your expertise covers authentication, authorization, encryption, vulnerability assessment, and secure coding practices. When given a task, identify and address security risks, enforce least-privilege principles, and harden the system against threats.`,
}

/**
 * Real-stack system prompts — describe each member's actual capability and
 * limits (governance-accurate: Atlas is explicitly advisory-only).
 */
const REAL_STACK_SYSTEM_PROMPTS: Record<string, string> = {
  cc: `Claude Code — implementation execution resource. Real dispatch runs against the configured Claude model via the Hermes gateway session for this crew member.`,
  cx: `Codex — architecture and technical-challenge execution resource. Real dispatch runs against the configured Codex model via the Hermes gateway session for this crew member.`,
  atlas: `GPT/Atlas — JP's external ChatGPT strategic advisory partner. Advisory only: no implementation/mutation authority and no live dispatch path. Tasks routed here must be handed off manually.`,
}

/**
 * Is the currently-active Hermes profile the primary/default Studio workspace?
 * Crew identity (real stack vs. virtual personas) is workspace-scoped: only
 * the default workspace represents JP's real execution stack. Other/future
 * workspaces (e.g. Candela3) keep the persona/virtual-employee catalog.
 */
export function isPrimaryWorkspace(): boolean {
  return getActiveProfileName() === 'default'
}

export function getBuiltInAgents(): AgentDefinition[] {
  if (isPrimaryWorkspace()) {
    return REAL_STACK_AGENTS.map((p) => ({
      id: `builtin-${p.name.toLowerCase()}`,
      name: p.name,
      emoji: p.emoji,
      color: p.color,
      roleLabel: p.role,
      systemPrompt: REAL_STACK_SYSTEM_PROMPTS[p.name.toLowerCase()] ?? '',
      model: p.defaultModel ?? null,
      tags: p.specialties.slice(0, 5),
      isBuiltIn: true,
      createdAt: 0,
      updatedAt: 0,
      advisory: p.advisory === true,
    }))
  }
  return AGENT_PERSONAS.map((p) => ({
    id: `builtin-${p.name.toLowerCase()}`,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    roleLabel: p.role,
    systemPrompt: BUILTIN_SYSTEM_PROMPTS[p.name.toLowerCase()] ?? '',
    model: null,
    tags: p.specialties.slice(0, 5),
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  }))
}

// ─── Custom agent store ───────────────────────────────────────────────────────

type StoreData = { agents: Record<string, AgentDefinition> }

let store: StoreData = { agents: {} }

function loadFromDisk(): void {
  try {
    const file = agentsFile()
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw) as StoreData
      if (parsed && typeof parsed.agents === 'object') {
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
    writeFileSync(agentsFile(), JSON.stringify(store, null, 2), 'utf-8')
  } catch {
    // ignore write errors
  }
}

let loadedForProfile: string | null = null
function ensureLoaded(): void {
  const active = getActiveProfileName()
  if (active === loadedForProfile) return
  store = { agents: {} }
  loadFromDisk()
  loadedForProfile = active
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** List all agents: built-ins first, then user-created sorted by newest. */
export function listAgents(): AgentDefinition[] {
  ensureLoaded()
  const custom = Object.values(store.agents).sort((a, b) => b.createdAt - a.createdAt)
  return [...getBuiltInAgents(), ...custom]
}

/** Get a single agent by id (built-in or custom). */
export function getAgent(id: string): AgentDefinition | null {
  ensureLoaded()
  if (id.startsWith('builtin-')) {
    return getBuiltInAgents().find((a) => a.id === id) ?? null
  }
  return store.agents[id] ?? null
}

/** Create a new custom agent. */
export function createAgent(input: {
  name: string
  emoji: string
  color: string
  roleLabel: string
  systemPrompt: string
  model: string | null
  tags: string[]
}): AgentDefinition {
  ensureLoaded()
  const id = randomUUID()
  const now = Date.now()
  const agent: AgentDefinition = {
    id,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  }
  store.agents[id] = agent
  saveToDisk()
  return agent
}

/** Update a custom agent. Built-ins cannot be mutated. */
export function updateAgent(
  id: string,
  updates: Partial<{
    name: string
    emoji: string
    color: string
    roleLabel: string
    systemPrompt: string
    model: string | null
    tags: string[]
  }>,
): AgentDefinition | null {
  ensureLoaded()
  const existing = store.agents[id]
  if (!existing) return null
  const updated: AgentDefinition = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  }
  store.agents[id] = updated
  saveToDisk()
  return updated
}

/** Delete a custom agent. Built-ins cannot be deleted. */
export function deleteAgent(id: string): boolean {
  ensureLoaded()
  if (!store.agents[id]) return false
  delete store.agents[id]
  saveToDisk()
  return true
}
