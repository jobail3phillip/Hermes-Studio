import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListModels = vi.fn()

vi.mock('@/server/hermes-api', () => ({
  ensureGatewayProbed: vi.fn(),
  getGatewayCapabilities: vi.fn(() => ({ models: true })),
  listModels: (...args: unknown[]) => mockListModels(...args),
}))

beforeEach(() => {
  mockListModels.mockReset()
})

describe('models route', () => {
  it('fetches models through the shared authenticated hermes-api client', async () => {
    mockListModels.mockResolvedValue({
      object: 'list',
      data: [{ id: 'hermes-agent', object: 'model' }],
    })
    const { fetchHermesModels } = await import('@/routes/api/models')
    const models = await fetchHermesModels()
    expect(mockListModels).toHaveBeenCalledTimes(1)
    expect(models).toEqual([
      expect.objectContaining({ id: 'hermes-agent', provider: 'hermes-agent' }),
    ])
  })

  it('propagates an auth failure from the gateway instead of silently returning nothing', async () => {
    mockListModels.mockRejectedValue(new Error('Hermes API /v1/models: 401 unauthorized'))
    const { fetchHermesModels } = await import('@/routes/api/models')
    await expect(fetchHermesModels()).rejects.toThrow('401')
  })
})
