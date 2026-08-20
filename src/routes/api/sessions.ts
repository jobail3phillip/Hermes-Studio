import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import YAML from 'yaml'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  createSession,
  deleteSession,
  ensureGatewayProbed,
  getGatewayCapabilities,
  listSessions,
  toSessionSummary,
  updateSession,
} from '../../server/hermes-api'
import {
  deleteLocalSession,
  ensureLocalSession,
  listLocalSessions,
  toLocalSessionSummary,
  updateLocalSessionTitle,
} from '../../server/local-session-store'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'

/** Virtual/placeholder model ids that must never be persisted as a session's real model. */
const VIRTUAL_MODELS = new Set(['default', 'hermes-agent'])

function readConfiguredDefault(): { model?: string; provider?: string } {
  try {
    const configPath = path.join(os.homedir(), '.hermes', 'config.yaml')
    const config = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as
      | Record<string, unknown>
      | null
      | undefined
    const modelConfig = config?.model
    if (typeof modelConfig === 'string') {
      return {
        model: modelConfig.trim() || undefined,
        provider:
          (typeof config?.provider === 'string' && config.provider.trim()) ||
          undefined,
      }
    }
    if (modelConfig && typeof modelConfig === 'object') {
      const record = modelConfig as Record<string, unknown>
      const model =
        (typeof record.default === 'string' && record.default) ||
        (typeof record.model === 'string' && record.model) ||
        ''
      const provider =
        (typeof record.provider === 'string' && record.provider) ||
        (typeof config?.provider === 'string' && config.provider) ||
        ''
      return { model: model.trim() || undefined, provider: provider.trim() || undefined }
    }
  } catch {
    /* ignore */
  }
  return {}
}

/**
 * Resolve the model to persist for a new session. Requests that omit a model
 * (e.g. the "new session for message" pre-create) must not leave it to the
 * gateway's own default, which persists the virtual "hermes-agent" id as the
 * session's real model — that then outranks every later per-request override.
 */
export function resolveSessionModel(requested: string | undefined): string | undefined {
  if (requested && !VIRTUAL_MODELS.has(requested)) return requested
  return readConfiguredDefault().model
}

/**
 * Resolve which provider a new session should be explicitly created against.
 * A request-supplied provider always wins; otherwise fall back to the
 * configured default so the session is pinned to the provider the user
 * actually selected via the model switcher.
 */
export function resolveSessionProvider(requested: string | undefined): string | undefined {
  if (requested) return requested
  return readConfiguredDefault().provider
}

export const Route = createFileRoute('/api/sessions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Auth check
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          const localSessions = listLocalSessions()
          return json({
            ok: true,
            sessions: localSessions.map(toLocalSessionSummary),
            source: 'local',
          })
        }

        try {
          const response = await listSessions(50, 0)
          // Handle OpenAI-format response: { object: "list", data: [...] }
          const sessionList = Array.isArray(response) ? response : (response?.data ?? [])
          return json({ ok: true, sessions: sessionList.map(toSessionSummary), source: 'gateway' })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheckPost = requireJsonContentType(request)
        if (csrfCheckPost) return csrfCheckPost
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          const body2 = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const requestedId =
            typeof body2.friendlyId === 'string' ? body2.friendlyId.trim() : ''
          const model =
            typeof body2.model === 'string' ? body2.model.trim() : undefined
          const friendlyId = requestedId || randomUUID()
          const session = ensureLocalSession(friendlyId, model)
          return json({
            ok: true,
            sessionKey: session.id,
            friendlyId: session.id,
            entry: toLocalSessionSummary(session),
            persisted: true,
            source: 'local',
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const requestedLabel =
            typeof body.label === 'string' ? body.label.trim() : ''
          const label = requestedLabel || undefined

          const requestedFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const friendlyId = requestedFriendlyId || randomUUID()

          const requestedModel =
            typeof body.model === 'string' ? body.model.trim() : ''
          const model = resolveSessionModel(requestedModel || undefined)
          const requestedProvider =
            typeof body.provider === 'string' ? body.provider.trim() : ''
          const provider = resolveSessionProvider(requestedProvider || undefined)
          const session = await createSession({
            id: friendlyId || randomUUID(),
            title: label,
            model,
            provider,
          })

          return json({
            ok: true,
            sessionKey: session.id,
            friendlyId: session.id,
            entry: toSessionSummary(session),
            modelApplied: true,
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheckPatch = requireJsonContentType(request)
        if (csrfCheckPatch) return csrfCheckPatch
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const sessionKey = rawSessionKey || rawFriendlyId
          const label =
            typeof body.label === 'string' ? body.label.trim() : undefined
          if (sessionKey && label) {
            updateLocalSessionTitle(sessionKey, label)
          }
          return json({
            ok: true,
            sessionKey: sessionKey || rawFriendlyId,
            friendlyId: rawFriendlyId || sessionKey,
            updated: !!label,
            source: 'local',
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const label =
            typeof body.label === 'string' ? body.label.trim() : undefined
          const sessionKey = rawSessionKey || rawFriendlyId

          if (!sessionKey) {
            return json(
              { ok: false, error: 'sessionKey required' },
              { status: 400 },
            )
          }

          const session = await updateSession(sessionKey, {
            title: label,
          })

          return json({
            ok: true,
            sessionKey,
            entry: toSessionSummary(session),
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          const url = new URL(request.url)
          const rawSessionKey = url.searchParams.get('sessionKey') ?? ''
          const rawFriendlyId = url.searchParams.get('friendlyId') ?? ''
          const sessionKey = rawSessionKey.trim() || rawFriendlyId.trim()
          if (sessionKey) deleteLocalSession(sessionKey)
          return json({
            ok: true,
            sessionKey,
            deleted: !!sessionKey,
            source: 'local',
          })
        }
        try {
          const url = new URL(request.url)
          const rawSessionKey = url.searchParams.get('sessionKey') ?? ''
          const rawFriendlyId = url.searchParams.get('friendlyId') ?? ''
          const sessionKey = rawSessionKey.trim() || rawFriendlyId.trim()

          if (!sessionKey) {
            return json(
              { ok: false, error: 'sessionKey required' },
              { status: 400 },
            )
          }

          await deleteSession(sessionKey)

          return json({ ok: true, sessionKey })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
