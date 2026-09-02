/**
 * Template store — file-backed persistence for user-created crew templates.
 *
 * Built-in templates are hardcoded and never written to disk.
 * User templates are stored in .runtime/templates.json.
 * Follows the same pattern as crew-store.ts and workflow-store.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getStudioRuntimeDir } from './runtime-dir'
import { getActiveProfileName } from './profiles-browser'
import type { CrewTemplate, CrewTemplateCategory } from '../types/template'
import { isPrimaryWorkspace } from './agent-definitions-store'

function dataDir(): string { return getStudioRuntimeDir() }
function templatesFile(): string { return join(dataDir(), 'templates.json') }

// ─── Real-stack built-in templates (primary/default workspace only) ─────────
// Members reference real execution-stack agents (cc/cx/atlas), not personas.

const REAL_STACK_TEMPLATES: CrewTemplate[] = [
  {
    id: 'builtin-feature-build',
    name: 'Feature Build',
    description: 'Implement a feature with Claude Code, with Codex available for architecture review.',
    icon: '🛠️',
    category: 'engineering',
    defaultGoal: 'Implement the feature end-to-end and report back with what changed and how it was verified.',
    defaultMembers: [
      { persona: 'cc', role: 'coordinator' },
      { persona: 'cx', role: 'reviewer' },
    ],
    isBuiltIn: true,
    tags: ['engineering', 'implementation', 'cc', 'cx'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-architecture-review',
    name: 'Architecture Review',
    description: 'Codex-led review of architecture or a technical challenge, with Claude Code available for follow-up implementation.',
    icon: '🏛️',
    category: 'engineering',
    defaultGoal: 'Assess the architecture / technical approach and produce a written recommendation.',
    defaultMembers: [
      { persona: 'cx', role: 'coordinator' },
      { persona: 'cc', role: 'executor' },
    ],
    isBuiltIn: true,
    tags: ['engineering', 'architecture', 'review', 'cx'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-strategy-consult',
    name: 'Strategy Consult',
    description: 'Bring in Atlas (GPT, advisory-only) for strategic input alongside real execution from CC/CX. Atlas requires a manual handoff — no auto-dispatch.',
    icon: '🧭',
    category: 'operations',
    defaultGoal: 'Gather strategic advisory input, then execute the resulting plan.',
    defaultMembers: [
      { persona: 'atlas', role: 'reviewer' },
      { persona: 'cc', role: 'coordinator' },
    ],
    isBuiltIn: true,
    tags: ['strategy', 'advisory', 'atlas'],
    templateType: 'crew' as const,
  },
]

// ─── Built-in templates (hardcoded, never persisted) ─────────────────────────

const BUILT_IN_TEMPLATES: CrewTemplate[] = [
  {
    id: 'builtin-research-team',
    name: 'Research Team',
    description:
      'Analyze topics in depth, synthesize findings, and produce structured reports.',
    icon: '🔬',
    category: 'research',
    defaultGoal: 'Research the topic thoroughly and produce a structured report with key findings and recommendations.',
    defaultMembers: [
      { persona: 'luna', role: 'executor' },
      { persona: 'ada', role: 'reviewer' },
      { persona: 'kai', role: 'coordinator' },
    ],
    isBuiltIn: true,
    tags: ['research', 'analysis', 'reporting'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-deep-dive',
    name: 'Deep Dive',
    description:
      'Two analysts plus a coordinator for exhaustive investigation of a complex subject.',
    icon: '🧐',
    category: 'research',
    defaultGoal: 'Conduct a comprehensive deep-dive investigation and deliver a detailed analysis document.',
    defaultMembers: [
      { persona: 'luna', role: 'executor' },
      { persona: 'roger', role: 'executor' },
      { persona: 'kai', role: 'coordinator' },
    ],
    isBuiltIn: true,
    tags: ['research', 'investigation', 'analysis'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-fullstack-squad',
    name: 'Full-Stack Squad',
    description:
      'End-to-end feature delivery with frontend, backend, DevOps, and QA coverage.',
    icon: '🏗️',
    category: 'engineering',
    defaultGoal: 'Design, build, test, and deploy the feature end-to-end across the full stack.',
    defaultMembers: [
      { persona: 'kai', role: 'coordinator' },
      { persona: 'roger', role: 'executor' },
      { persona: 'sally', role: 'executor' },
      { persona: 'max', role: 'specialist' },
      { persona: 'ada', role: 'reviewer' },
    ],
    isBuiltIn: true,
    tags: ['engineering', 'fullstack', 'feature'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-code-review',
    name: 'Code Review Crew',
    description:
      'Thorough code review covering correctness, security, and maintainability.',
    icon: '🔍',
    category: 'engineering',
    defaultGoal: 'Review the codebase for quality, security vulnerabilities, and best-practice adherence.',
    defaultMembers: [
      { persona: 'ada', role: 'executor' },
      { persona: 'luna', role: 'reviewer' },
      { persona: 'nova', role: 'specialist' },
    ],
    isBuiltIn: true,
    tags: ['engineering', 'review', 'quality'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-content-studio',
    name: 'Content Studio',
    description:
      'Create compelling content: research, write, and polish for any channel.',
    icon: '✍️',
    category: 'creative',
    defaultGoal: 'Research the subject, draft engaging content, and refine it for the target audience.',
    defaultMembers: [
      { persona: 'bill', role: 'coordinator' },
      { persona: 'luna', role: 'executor' },
      { persona: 'roger', role: 'reviewer' },
    ],
    isBuiltIn: true,
    tags: ['creative', 'content', 'writing', 'marketing'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-ops-team',
    name: 'Ops Team',
    description:
      'Infrastructure, deployment, and backend reliability across a system.',
    icon: '⚙️',
    category: 'operations',
    defaultGoal: 'Audit, optimize, and stabilize the infrastructure and deployment pipeline.',
    defaultMembers: [
      { persona: 'max', role: 'coordinator' },
      { persona: 'sally', role: 'executor' },
      { persona: 'kai', role: 'executor' },
    ],
    isBuiltIn: true,
    tags: ['operations', 'devops', 'infrastructure'],
    templateType: 'crew' as const,
  },
  {
    id: 'builtin-sprint-team',
    name: 'Sprint Team',
    description:
      'Balanced cross-functional crew for delivering a focused sprint of work.',
    icon: '⚡',
    category: 'operations',
    defaultGoal: 'Plan, execute, and review a focused sprint to deliver the defined scope on time.',
    defaultMembers: [
      { persona: 'kai', role: 'coordinator' },
      { persona: 'roger', role: 'executor' },
      { persona: 'sally', role: 'executor' },
      { persona: 'ada', role: 'reviewer' },
    ],
    isBuiltIn: true,
    tags: ['operations', 'sprint', 'delivery'],
    templateType: 'crew' as const,
  },
  {
    id: 'conductor-research',
    name: 'Research Mission',
    description: 'Deep research on a topic with parallel investigators and a synthesizer',
    icon: '🔬',
    category: 'conductor' as const,
    defaultGoal: 'Research and synthesize findings on...',
    defaultMembers: [
      { persona: 'kai', role: 'coordinator' as const },
      { persona: 'nova', role: 'executor' as const },
    ],
    isBuiltIn: true,
    tags: ['research', 'analysis', 'conductor'],
    templateType: 'conductor' as const,
    conductorConfig: { maxParallel: 2, supervised: false },
  },
  {
    id: 'conductor-build',
    name: 'Build Mission',
    description: 'Plan, implement, and review a feature with specialized workers',
    icon: '🏗️',
    category: 'conductor' as const,
    defaultGoal: 'Build and deliver...',
    defaultMembers: [
      { persona: 'kai', role: 'coordinator' as const },
      { persona: 'roger', role: 'executor' as const },
      { persona: 'quinn', role: 'reviewer' as const },
    ],
    isBuiltIn: true,
    tags: ['build', 'development', 'conductor'],
    templateType: 'conductor' as const,
    conductorConfig: { maxParallel: 2, supervised: false },
  },
  {
    id: 'conductor-review',
    name: 'Review Mission',
    description: 'Audit code, docs, or architecture with parallel reviewers',
    icon: '🔍',
    category: 'conductor' as const,
    defaultGoal: 'Review and audit...',
    defaultMembers: [
      { persona: 'quinn', role: 'reviewer' as const },
      { persona: 'nova', role: 'specialist' as const },
    ],
    isBuiltIn: true,
    tags: ['review', 'audit', 'conductor'],
    templateType: 'conductor' as const,
    conductorConfig: { maxParallel: 2, supervised: true },
  },
  {
    id: 'conductor-deploy',
    name: 'Deploy Mission',
    description: 'Deploy and verify infrastructure or application changes',
    icon: '🚀',
    category: 'conductor' as const,
    defaultGoal: 'Deploy and verify...',
    defaultMembers: [
      { persona: 'kai', role: 'coordinator' as const },
      { persona: 'roger', role: 'executor' as const },
    ],
    isBuiltIn: true,
    tags: ['deploy', 'infrastructure', 'conductor'],
    templateType: 'conductor' as const,
    conductorConfig: { maxParallel: 1, supervised: true },
  },
]

// ─── User template store (file-backed) ───────────────────────────────────────

type StoreData = { templates: Record<string, CrewTemplate> }

let store: StoreData = { templates: {} }

function loadFromDisk(): void {
  try {
    const file = templatesFile()
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw) as StoreData
      if (parsed?.templates && typeof parsed.templates === 'object') {
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
    writeFileSync(templatesFile(), JSON.stringify(store, null, 2))
  } catch {
    // ignore write failure — in-memory is still consistent
  }
}

let loadedForProfile: string | null = null
function ensureLoaded(): void {
  const active = getActiveProfileName()
  if (active === loadedForProfile) return
  store = { templates: {} }
  loadFromDisk()
  loadedForProfile = active
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns all templates: built-ins first (declaration order), then user templates newest-first. */
export function listTemplates(): CrewTemplate[] {
  ensureLoaded()
  const userTemplates = Object.values(store.templates).sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  )
  const builtins = isPrimaryWorkspace() ? REAL_STACK_TEMPLATES : BUILT_IN_TEMPLATES
  return [...builtins, ...userTemplates]
}

export function getTemplate(id: string): CrewTemplate | null {
  ensureLoaded()
  const builtin = [...BUILT_IN_TEMPLATES, ...REAL_STACK_TEMPLATES].find((t) => t.id === id)
  if (builtin) return builtin
  return store.templates[id] ?? null
}

export function createUserTemplate(input: {
  name: string
  description: string
  icon: string
  category: CrewTemplateCategory
  defaultGoal: string
  defaultMembers: Array<{ persona: string; role: CrewTemplate['defaultMembers'][number]['role'] }>
  tags: string[]
  templateType?: CrewTemplate['templateType']
  conductorConfig?: CrewTemplate['conductorConfig']
}): CrewTemplate {
  ensureLoaded()
  const template: CrewTemplate = {
    id: `user-${randomUUID()}`,
    ...input,
    templateType: input.templateType ?? 'crew',
    isBuiltIn: false,
    createdAt: Date.now(),
  }
  store.templates[template.id] = template
  saveToDisk()
  return template
}

/** Returns false if id not found or if template is built-in. */
export function deleteUserTemplate(id: string): boolean {
  const template = getTemplate(id)
  if (!template) return false
  if (template.isBuiltIn) return false
  delete store.templates[id]
  saveToDisk()
  return true
}
