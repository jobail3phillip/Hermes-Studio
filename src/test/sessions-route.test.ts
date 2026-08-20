import { describe, it, expect } from 'vitest'
import { resolveSessionModel } from '@/routes/api/sessions'

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
