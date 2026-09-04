/**
 * Client-side API helpers for operations dashboard.
 */

import type { OperationAgent } from '@/types/operation'
import type { OperationsWorkItemsResponse } from '@/types/operations-work-item'

export async function fetchOperationsOverview(): Promise<OperationAgent[]> {
  const res = await fetch('/api/operations')
  const data = (await res.json()) as { ok: boolean; agents?: OperationAgent[] }
  return data.agents ?? []
}

export async function fetchOperationsWorkItems(): Promise<OperationsWorkItemsResponse> {
  const res = await fetch('/api/operations/work-items')
  return (await res.json()) as OperationsWorkItemsResponse
}
