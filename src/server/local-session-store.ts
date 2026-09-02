import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRedisClient, getRedisClientSync } from './redis-client'
import { getStudioRuntimeDir } from './runtime-dir'
import { getActiveProfileName } from './profiles-browser'

function dataDir(): string { return getStudioRuntimeDir() }
function sessionsFile(): string { return join(dataDir(), 'local-sessions.json') }
const MAX_MESSAGES_PER_SESSION = 500

// Redis key prefix — resolved per-call so a live profile switch takes effect
// immediately (see redisPrefix() call sites below).
function redisPrefix(): string { return `hermes:studio:${getActiveProfileName()}` }

export type LocalSession = {
  id: string
  title: string | null
  model: string | null
  createdAt: number
  updatedAt: number
  messageCount: number
}

export type LocalMessage = {
  id: string
  role: string
  content: string
  timestamp: number
  toolCalls?: unknown
  toolCallId?: string
  toolName?: string
}

type StoreData = {
  sessions: Record<string, LocalSession>
  messages: Record<string, Array<LocalMessage>>
}

// ─── In-memory cache ────────────────────────────────────────────────────────

let store: StoreData = { sessions: {}, messages: {} }

// ─── File-based persistence ─────────────────────────────────────────────────

function loadFromDisk(): void {
  try {
    const file = sessionsFile()
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw) as StoreData
      if (parsed.sessions && parsed.messages) {
        store = parsed
      }
    }
  } catch {
    // ignore corrupt local cache
  }
}

function saveToDisk(): void {
  try {
    const dir = dataDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(sessionsFile(), JSON.stringify(store, null, 2))
  } catch {
    // ignore cache write failures
  }
}

// ─── Redis backend (optional) ────────────────────────────────────────────────
// Activated when REDIS_URL env var is set. Falls back to file store silently.

async function loadFromRedis(client: import('ioredis').Redis): Promise<void> {
  try {
    const prefix = redisPrefix()
    const sessionKeys = await client.hkeys(`${prefix}:sessions`)
    const sessions: Record<string, LocalSession> = {}
    const messages: Record<string, Array<LocalMessage>> = {}

    for (const sid of sessionKeys) {
      const raw = await client.hget(`${prefix}:sessions`, sid)
      if (raw) {
        try {
          sessions[sid] = JSON.parse(raw) as LocalSession
        } catch {
          // skip corrupt entry
        }
      }
      const msgs = await client.lrange(`${prefix}:messages:${sid}`, 0, -1)
      messages[sid] = msgs.flatMap((m) => {
        try {
          return [JSON.parse(m) as LocalMessage]
        } catch {
          return []
        }
      })
    }

    // Merge: prefer Redis data (more recent) over file data
    store = {
      sessions: { ...store.sessions, ...sessions },
      messages: { ...store.messages, ...messages },
    }
  } catch {
    // Redis load failed — stick with file data
  }
}

async function saveSessionToRedis(
  client: import('ioredis').Redis,
  session: LocalSession,
): Promise<void> {
  try {
    const prefix = redisPrefix()
    await client.hset(
      `${prefix}:sessions`,
      session.id,
      JSON.stringify(session),
    )
    // 30-day TTL on the sessions hash key
    await client.expire(`${prefix}:sessions`, 60 * 60 * 24 * 30)
  } catch {
    // ignore Redis write failures
  }
}

async function appendMessageToRedis(
  client: import('ioredis').Redis,
  sessionId: string,
  message: LocalMessage,
): Promise<void> {
  try {
    const key = `${redisPrefix()}:messages:${sessionId}`
    await client.rpush(key, JSON.stringify(message))
    await client.ltrim(key, -MAX_MESSAGES_PER_SESSION, -1)
    await client.expire(key, 60 * 60 * 24 * 30)
  } catch {
    // ignore Redis write failures
  }
}

async function deleteSessionFromRedis(
  client: import('ioredis').Redis,
  sessionId: string,
): Promise<void> {
  try {
    const prefix = redisPrefix()
    await client.hdel(`${prefix}:sessions`, sessionId)
    await client.del(`${prefix}:messages:${sessionId}`)
  } catch {
    // ignore
  }
}

// Bootstrap: load from file immediately, then connect shared Redis client.
// If REDIS_URL is set but Redis isn't ready yet (common in Docker during
// container startup), retry with exponential backoff before giving up.
// ponytail: single-process, no per-request profile pinning — a request in
// flight during a profile switch may observe the new profile's data
// mid-request. Acceptable for single-user manual switching; revisit with
// request-scoped profile context if Studio ever serves concurrent
// multi-profile traffic.
//
// KNOWN LIMITATION (accepted per CX review): this one-shot Redis hydration
// IIFE runs once at module load for whichever profile is active at boot and
// is NOT re-triggered on a live profile switch — Redis rehydration is not
// profile-switch-aware in this pass. New Redis reads/writes after a switch
// do use the live-resolved prefix (redisPrefix()), so they land in the
// correct namespace; only the initial hydration merge is boot-profile-scoped.
let loadedForProfile: string | null = null
loadFromDisk()
loadedForProfile = getActiveProfileName()
void (async () => {
  if (!process.env.REDIS_URL) return // no Redis configured — skip entirely

  const delays = [2_000, 4_000, 8_000, 16_000] // max ~30s total
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const client = await getRedisClient()
    if (client) {
      await loadFromRedis(client)
      console.log('[session-store] Redis backend active')
      return
    }
    if (attempt < delays.length) {
      const wait = delays[attempt]
      console.log(`[session-store] Redis not ready — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${delays.length})`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  console.log('[session-store] Redis unavailable after retries — using file store')
})()

// ─── Deferred write scheduler ───────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveToDisk()
  }, 2000)
}

function ensureLoaded(): void {
  const active = getActiveProfileName()
  if (active === loadedForProfile) return
  store = { sessions: {}, messages: {} }
  loadFromDisk()
  loadedForProfile = active
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function listLocalSessions(): Array<LocalSession> {
  ensureLoaded()
  return Object.values(store.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getLocalSession(sessionId: string): LocalSession | null {
  ensureLoaded()
  return store.sessions[sessionId] ?? null
}

export function ensureLocalSession(
  sessionId: string,
  model?: string,
): LocalSession {
  ensureLoaded()
  if (!store.sessions[sessionId]) {
    store.sessions[sessionId] = {
      id: sessionId,
      title: null,
      model: model ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    }
    store.messages[sessionId] = []
    saveToDisk()
    if (getRedisClientSync()) void saveSessionToRedis(getRedisClientSync()!, store.sessions[sessionId])
  }
  return store.sessions[sessionId]
}

export function updateLocalSessionTitle(
  sessionId: string,
  title: string,
): void {
  ensureLoaded()
  const session = store.sessions[sessionId]
  if (session) {
    session.title = title
    session.updatedAt = Date.now()
    saveToDisk()
    if (getRedisClientSync()) void saveSessionToRedis(getRedisClientSync()!, session)
  }
}

export function touchLocalSession(sessionId: string): void {
  ensureLoaded()
  const session = store.sessions[sessionId]
  if (session) session.updatedAt = Date.now()
}

export function deleteLocalSession(sessionId: string): void {
  ensureLoaded()
  delete store.sessions[sessionId]
  delete store.messages[sessionId]
  saveToDisk()
  if (getRedisClientSync()) void deleteSessionFromRedis(getRedisClientSync()!, sessionId)
}

export function getLocalMessages(sessionId: string): Array<LocalMessage> {
  ensureLoaded()
  return store.messages[sessionId] ?? []
}

export function appendLocalMessage(
  sessionId: string,
  message: LocalMessage,
): void {
  ensureLoaded()
  ensureLocalSession(sessionId)
  if (!store.messages[sessionId]) store.messages[sessionId] = []
  store.messages[sessionId].push(message)
  if (store.messages[sessionId].length > MAX_MESSAGES_PER_SESSION) {
    store.messages[sessionId] = store.messages[sessionId].slice(
      -MAX_MESSAGES_PER_SESSION,
    )
  }
  const session = store.sessions[sessionId]
  if (session) {
    session.messageCount = store.messages[sessionId].length
    session.updatedAt = Date.now()
  }
  scheduleSave()
  if (getRedisClientSync()) void appendMessageToRedis(getRedisClientSync()!, sessionId, message)
}

// ─── Client-format adapters ──────────────────────────────────────────────────

/** Convert a LocalSession → the session summary format the frontend expects */
export function toLocalSessionSummary(
  session: LocalSession,
): Record<string, unknown> {
  return {
    key: session.id,
    friendlyId: session.id,
    kind: 'chat',
    status: 'idle',
    model: session.model || '',
    label: session.title || session.id,
    title: session.title || session.id,
    derivedTitle: session.title || session.id,
    tokenCount: 0,
    totalTokens: 0,
    message_count: session.messageCount,
    messageCount: session.messageCount,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    source: 'local',
  }
}

/** Convert a LocalMessage → the ChatMessage format the frontend expects */
export function toLocalChatMessage(
  msg: LocalMessage,
  index: number,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = []

  if (msg.role === 'tool') {
    content.push({
      type: 'tool_result',
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      text: msg.content || '',
    })
  } else {
    if (msg.content) {
      content.push({ type: 'text', text: msg.content })
    }
  }

  return {
    id: `local-${msg.id}`,
    role: msg.role,
    content,
    text: msg.content || '',
    timestamp: msg.timestamp,
    createdAt: new Date(msg.timestamp).toISOString(),
    __historyIndex: index,
    source: 'local',
  }
}
