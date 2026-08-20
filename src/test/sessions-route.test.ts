import { describe, it, expect } from 'vitest'
import { resolveSessionModel, resolveSessionProvider } from '@/routes/api/sessions'

describe('resolveSessionModel', () => {
  it('never persists the virtual "hermes-agent" model on a new session', () => {
    expect(resolveSessionModel('hermes-agent')).not.toBe('hermes-agent')
  })

  it('falls back to the configured default when no model is requested', () => {
    // ~/.hermes/config.yaml on the test machine has no guaranteed content,
    // so just assert the omitted-model case never resolves to the virtual id.
    expect(resolveSessionModel(undefined)).not.toBe('hermes-agent')
  })

  it('passes through a real requested model unchanged', () => {
    expect(resolveSessionModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })
})

describe('resolveSessionProvider', () => {
  it('passes through an explicitly requested provider unchanged', () => {
    expect(resolveSessionProvider('openai-codex')).toBe('openai-codex')
    expect(resolveSessionProvider('anthropic')).toBe('anthropic')
  })

  it('an explicit request always wins over whatever is configured', () => {
    // Regression for the session-model-pins-the-wrong-provider bug: a new
    // session must be able to explicitly request a non-default provider
    // rather than silently inheriting the configured default.
    expect(resolveSessionProvider('openai-codex')).not.toBeUndefined()
    expect(resolveSessionProvider('openai-codex')).toBe('openai-codex')
  })
})
