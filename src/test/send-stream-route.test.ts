import { describe, it, expect } from 'vitest'
import { resolveRequestModel, resolveRequestProvider } from '@/routes/api/send-stream'

describe('resolveRequestModel', () => {
  it('never sends the virtual "hermes-agent" model id to the gateway', () => {
    expect(resolveRequestModel('hermes-agent')).not.toBe('hermes-agent')
  })

  it('passes through a real requested model unchanged', () => {
    expect(resolveRequestModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })
})

describe('resolveRequestProvider', () => {
  it('passes through an explicitly requested provider unchanged', () => {
    expect(resolveRequestProvider('openai-codex')).toBe('openai-codex')
    expect(resolveRequestProvider('anthropic')).toBe('anthropic')
  })

  it('an explicit request always wins over whatever is configured', () => {
    // Regression: a chat turn must be able to explicitly pin a provider
    // (e.g. openai-codex) rather than silently inheriting whatever a
    // pinned session or the global config currently resolves to.
    expect(resolveRequestProvider('openai-codex')).toBe('openai-codex')
  })
})
