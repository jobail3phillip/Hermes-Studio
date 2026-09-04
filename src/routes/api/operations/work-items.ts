/**
 * GET /api/operations/work-items — unified Intake/Mission/Repo-Review/SW-Review
 * work items, sourced from the real governance corpus on disk (see
 * server/operations-records.ts). Full dataset every call — no client-side-only
 * pagination that would break "search the full history" (STUDIO-017 req #2).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  listOperationsWorkItems,
  isOperationsCorpusAvailable,
  operationsPaths,
} from '../../../server/operations-records'
import type { OperationsWorkItemsResponse } from '../../../types/operations-work-item'

export const Route = createFileRoute('/api/operations/work-items')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const paths = operationsPaths()
        const available = isOperationsCorpusAvailable()
        if (!available) {
          const body: OperationsWorkItemsResponse = {
            ok: true,
            items: [],
            source: { available: false, ...paths, error: 'Governance corpus directory not found on this machine.' },
          }
          return json(body)
        }
        try {
          const items = listOperationsWorkItems()
          const body: OperationsWorkItemsResponse = {
            ok: true,
            items,
            source: { available: true, ...paths },
          }
          return json(body)
        } catch (err) {
          const body: OperationsWorkItemsResponse = {
            ok: false,
            items: [],
            source: { available: false, ...paths, error: err instanceof Error ? err.message : String(err) },
          }
          return json(body, { status: 500 })
        }
      },
    },
  },
})
