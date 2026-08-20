import { describe, it, expect } from 'vitest'
import { buildRequestBody } from '@/server/openai-compat-api'

describe('buildRequestBody', () => {
  it('never sends the virtual "hermes-agent" model id to the gateway', async () => {
    const body = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      model: 'hermes-agent',
    })
    expect(body.model).not.toBe('hermes-agent')
  })

  it('passes through a real model id unchanged', async () => {
    const body = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      model: 'claude-sonnet-4-6',
    })
    expect(body.model).toBe('claude-sonnet-4-6')
  })
})
