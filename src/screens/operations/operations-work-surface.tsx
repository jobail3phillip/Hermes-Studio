/**
 * Operations screen — unified Intake / Missions / Repository Reviews /
 * Software Reviews control surface.
 *
 * Built from the HFA-approved STUDIO-016 Meridian design artifact
 * (studio-016-meridian-operational-page-design-a38b/operations-center.html)
 * per STUDIO-017. Preserves that design's visual hierarchy (HFA banner →
 * needs-attention section always first → recently-closed → historical) and
 * interaction model (toolbar search/type/status filters, grouping toggle,
 * in-place expandable row detail, keyboard row activation, HFA-jump).
 *
 * Data: real governed mission/review records under
 * ~/Documents/AI/hermes/operations/{missions,reviews} via
 * GET /api/operations/work-items (server/operations-records.ts). No mock data.
 *
 * Governance note (STUDIO-017 hard requirement #4): the design mockup shows
 * Approve/Reject/Defer/Route buttons. Studio has no existing mechanism that
 * performs those state-changing dispositions (the governance corpus is
 * hand-authored markdown edited by Axi/CX/HFA outside Studio) — so those
 * actions are rendered disabled with a TODO tooltip rather than invented.
 * "Open Record" just reveals the on-disk path — informational, not a
 * state change — so it is safe to leave live.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Search01Icon,
  Alert02Icon,
  FolderOpenIcon,
} from '@hugeicons/core-free-icons'
import { EmptyState } from '@/components/ds/empty-state'
import { cn } from '@/lib/utils'
import { fetchOperationsWorkItems } from '@/lib/operations-api'
import type {
  WorkItem,
  WorkItemType,
  WorkItemPhase,
  GroupMode,
} from '@/types/operations-work-item'

const TYPE_META: Record<WorkItemType, { label: string; chip: string; hue: string }> = {
  mission: { label: 'Mission', chip: 'M', hue: '145' },
  'repo-review': { label: 'Repo Review', chip: 'R', hue: '245' },
  'sw-review': { label: 'SW Review', chip: 'S', hue: '70' },
  intake: { label: 'Intake', chip: 'I', hue: '275' },
}

const PHASE_META: Record<WorkItemPhase, { title: string; icon: string }> = {
  'needs-attention': { title: 'Needs Attention', icon: '\u25c6' },
  'recently-closed': { title: 'Recently Closed', icon: '\u2713' },
  historical: { title: 'Historical \u00b7 Closed', icon: '\u22a1' },
}
const PHASE_ORDER: WorkItemPhase[] = ['needs-attention', 'recently-closed', 'historical']

type StatusFilter = 'all' | 'open' | 'closed'

function typeChipStyle(hue: string): React.CSSProperties {
  return {
    background: `oklch(93% 0.05 ${hue})`,
    color: `oklch(30% 0.12 ${hue})`,
  }
}

function groupItems(items: WorkItem[], mode: GroupMode): Array<{ key: string; title: string; items: WorkItem[] }> {
  if (mode === 'phase') {
    return PHASE_ORDER.map((phase) => ({
      key: phase,
      title: PHASE_META[phase].title,
      items: items.filter((i) => i.phase === phase),
    })).filter((g) => g.items.length > 0)
  }
  if (mode === 'type') {
    const order: WorkItemType[] = ['intake', 'mission', 'repo-review', 'sw-review']
    return order
      .map((t) => ({ key: t, title: TYPE_META[t].label + 's', items: items.filter((i) => i.type === t) }))
      .filter((g) => g.items.length > 0)
  }
  // resource
  const byResource = new Map<string, WorkItem[]>()
  for (const item of items) {
    const list = byResource.get(item.resource) ?? []
    list.push(item)
    byResource.set(item.resource, list)
  }
  return [...byResource.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([resource, list]) => ({ key: resource, title: resource, items: list }))
}

export function OperationsScreen() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['operations-work-items'],
    queryFn: fetchOperationsWorkItems,
    refetchInterval: 30_000,
  })

  const [search, setSearch] = useState('')
  const [typeFilters, setTypeFilters] = useState<Set<WorkItemType>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('phase')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['historical']))
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const allItems = data?.items ?? []

  const hfaAttentionItems = useMemo(
    () => allItems.filter((i) => i.phase === 'needs-attention'),
    [allItems],
  )

  // Search/filter always run against the FULL persisted dataset (allItems),
  // including historical/closed records — never just what's on screen.
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allItems.filter((item) => {
      if (typeFilters.size > 0 && !typeFilters.has(item.type)) return false
      if (statusFilter === 'open' && item.closed) return false
      if (statusFilter === 'closed' && !item.closed) return false
      if (q) {
        const hay = `${item.id} ${item.title} ${item.resource} ${item.summary}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allItems, typeFilters, statusFilter, search])

  const groups = useMemo(() => groupItems(filteredItems, groupMode), [filteredItems, groupMode])

  const hasActiveFilters = search.trim() !== '' || typeFilters.size > 0 || statusFilter !== 'all'

  function toggleType(t: WorkItemType) {
    setTypeFilters((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function clearFilters() {
    setSearch('')
    setTypeFilters(new Set())
    setStatusFilter('all')
  }

  function toggleGroupCollapse(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // HFA-jump: must both focus AND expand the target item (STUDIO-017 req #3),
  // not just scroll to it. Also un-collapses whatever group currently holds it.
  function jumpToItem(id: string) {
    const item = allItems.find((i) => i.id === id)
    if (!item) return
    setCollapsedGroups((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(prev)
      next.delete(item.phase)
      next.delete(item.type)
      next.delete(item.resource)
      return next
    })
    setExpandedId(id)
    // Wait a tick for the row to (re)mount/expand before focusing it.
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(id)
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  function handleRowKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setExpandedId((cur) => (cur === id ? null : id))
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--theme-muted)' }}>
        Loading operations…
      </div>
    )
  }

  if (isError || data?.ok === false) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<HugeiconsIcon icon={Alert02Icon} size={32} />}
          title="Operations data unavailable"
          description={
            data?.source.error ??
            (error instanceof Error ? error.message : 'Could not read the governance record on disk.')
          }
        />
      </div>
    )
  }

  const sourceUnavailable = data?.source.available === false

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--theme-bg)' }}>
      {/* Topbar */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-6 py-3"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <h1 className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
          Operations
        </h1>
        <span className="h-3.5 w-px" style={{ background: 'var(--theme-border)' }} />
        <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>
          Intake &middot; Missions &middot; Reviews
        </span>
        <span className="ml-auto text-xs" style={{ color: 'var(--theme-muted)' }}>
          {allItems.length} record{allItems.length !== 1 ? 's' : ''}
        </span>
      </div>

      {sourceUnavailable && (
        <div
          className="shrink-0 px-6 py-2 text-xs"
          style={{ background: 'var(--theme-warning)', color: 'var(--theme-bg)' }}
        >
          Governance record directory not found on this machine ({data?.source.missionsDir}). Showing no records.
        </div>
      )}

      {/* HFA banner */}
      {hfaAttentionItems.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="flex shrink-0 items-center gap-3 border-b px-6 py-2"
          style={{ background: 'var(--theme-accent-subtle)', borderColor: 'var(--theme-border)' }}
        >
          <span aria-hidden style={{ color: 'var(--theme-active)' }}>&#9670;</span>
          <span className="text-xs font-medium" style={{ color: 'var(--theme-text)' }}>
            <strong>{hfaAttentionItems.length}</strong> item{hfaAttentionItems.length !== 1 ? 's' : ''} need attention:
          </span>
          <div className="flex flex-wrap gap-2">
            {hfaAttentionItems.map((item) => (
              <button
                key={item.id}
                onClick={() => jumpToItem(item.id)}
                aria-label={`Jump to ${item.id}`}
                className="rounded-full px-2.5 py-0.5 text-[11px] font-mono font-semibold"
                style={{ background: 'var(--theme-hover)', color: 'var(--theme-text)' }}
              >
                {item.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-3"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div
          className="flex w-56 items-center gap-2 rounded-md border px-2.5 py-1.5"
          style={{ background: 'var(--theme-input)', borderColor: 'var(--theme-border)' }}
        >
          <HugeiconsIcon icon={Search01Icon} size={13} style={{ color: 'var(--theme-muted)' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, title, resource…"
            aria-label="Search operations"
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: 'var(--theme-text)' }}
          />
        </div>

        <div className="flex gap-1" role="group" aria-label="Filter by type">
          {(Object.keys(TYPE_META) as WorkItemType[]).map((t) => {
            const active = typeFilters.has(t)
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                aria-pressed={active}
                className="rounded px-2 py-1 text-[11px] font-medium"
                style={
                  active
                    ? { background: `oklch(36% 0.14 ${TYPE_META[t].hue})`, color: '#fff' }
                    : { color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }
                }
              >
                {TYPE_META[t].label}
              </button>
            )
          })}
        </div>

        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {(['all', 'open', 'closed'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className="rounded px-2 py-1 text-[11px] font-medium capitalize"
              style={
                statusFilter === s
                  ? { background: 'var(--theme-text)', color: 'var(--theme-bg)' }
                  : { color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }
              }
            >
              {s}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px]" style={{ color: 'var(--theme-muted)' }}>
            Group:
          </span>
          {(['phase', 'type', 'resource'] as GroupMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setGroupMode(mode)}
              aria-pressed={groupMode === mode}
              className="rounded px-2 py-1 text-[11px] font-mono capitalize"
              style={
                groupMode === mode
                  ? { background: 'var(--theme-hover)', color: 'var(--theme-text)' }
                  : { color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }
              }
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {hasActiveFilters && (
        <div
          className="mx-6 mt-2 flex shrink-0 items-center gap-2 rounded px-3 py-1 text-[11px]"
          style={{ background: 'var(--theme-accent-subtle)', color: 'var(--theme-text)' }}
        >
          <span>Filtering active — {filteredItems.length} of {allItems.length} records match</span>
          <button onClick={clearFilters} className="font-semibold underline">
            Clear all
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-10">
        {groups.length === 0 ? (
          <div className="pt-10">
            <EmptyState
              icon={<HugeiconsIcon icon={FolderOpenIcon} size={32} />}
              title={allItems.length === 0 ? 'No operations records found' : 'No records match this filter'}
              description={
                allItems.length === 0
                  ? 'No mission or review records were found in the governance corpus.'
                  : 'Try clearing filters or search.'
              }
            />
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key)
            return (
              <div key={group.key} className="mt-5">
                <div
                  className="mb-2 flex items-center gap-2 border-b pb-1.5"
                  style={{ borderColor: 'var(--theme-border)' }}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--theme-muted)' }}>
                    {group.title}
                  </span>
                  <span
                    className="rounded-full border px-1.5 text-[10px] font-mono"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)' }}
                  >
                    {group.items.length}
                  </span>
                  <button
                    onClick={() => toggleGroupCollapse(group.key)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.title}`}
                    className="ml-auto text-[11px]"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                </div>

                {!isCollapsed &&
                  group.items.map((item) => {
                    const isOpen = expandedId === item.id
                    const meta = TYPE_META[item.type]
                    return (
                      <div key={item.id} className="mb-1">
                        <div
                          ref={(el) => {
                            if (el) rowRefs.current.set(item.id, el)
                            else rowRefs.current.delete(item.id)
                          }}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isOpen}
                          aria-label={`${item.id} — ${item.title}, ${item.closed ? 'closed' : 'open'}`}
                          onClick={() => setExpandedId(isOpen ? null : item.id)}
                          onKeyDown={(e) => handleRowKeyDown(e, item.id)}
                          className={cn(
                            'grid cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-xs outline-none',
                            'focus-visible:ring-2 focus-visible:ring-offset-1',
                          )}
                          style={{
                            gridTemplateColumns: '24px 110px 1fr auto auto 70px',
                            background: 'var(--theme-input)',
                            borderColor: 'var(--theme-border)',
                            borderLeft: item.phase === 'needs-attention' ? '3px solid var(--theme-active)' : undefined,
                            opacity: item.closed && item.phase === 'historical' ? 0.7 : 1,
                          }}
                        >
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded text-[9px] font-extrabold"
                            style={typeChipStyle(meta.hue)}
                            title={meta.label}
                          >
                            {meta.chip}
                          </span>
                          <span className="truncate font-mono text-[11px]" style={{ color: 'var(--theme-muted)' }}>
                            {item.id}
                          </span>
                          <span className="truncate font-medium" style={{ color: 'var(--theme-text)' }}>
                            {item.title}
                          </span>
                          <span
                            className="whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px]"
                            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)' }}
                          >
                            {item.resource}
                          </span>
                          <span
                            className="whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold"
                            style={
                              item.phase === 'needs-attention'
                                ? { background: 'var(--theme-accent-subtle)', color: 'var(--theme-text)' }
                                : item.closed
                                  ? { background: 'var(--theme-hover)', color: 'var(--theme-muted)' }
                                  : { color: 'var(--theme-muted)' }
                            }
                          >
                            {item.closed ? 'Closed' : item.phase === 'needs-attention' ? 'Needs Attention' : 'Open'}
                          </span>
                          <span className="text-right font-mono text-[10px]" style={{ color: 'var(--theme-muted)' }}>
                            {item.createdAt ?? '—'}
                          </span>
                        </div>

                        {isOpen && (
                          <div
                            className="grid grid-cols-2 gap-4 rounded-b-md border border-t-0 p-4 text-xs"
                            style={{ background: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
                          >
                            <div>
                              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--theme-muted)' }}>
                                Record
                              </div>
                              <dl className="space-y-1">
                                <div className="flex gap-2">
                                  <dt className="w-20 font-mono text-[11px]" style={{ color: 'var(--theme-muted)' }}>ID</dt>
                                  <dd className="font-mono text-[11px]">{item.id}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="w-20 font-mono text-[11px]" style={{ color: 'var(--theme-muted)' }}>Type</dt>
                                  <dd>{meta.label}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="w-20 font-mono text-[11px]" style={{ color: 'var(--theme-muted)' }}>Resource</dt>
                                  <dd>{item.resource}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="w-20 font-mono text-[11px]" style={{ color: 'var(--theme-muted)' }}>Path</dt>
                                  <dd className="font-mono text-[11px] break-all">{item.recordPath}</dd>
                                </div>
                              </dl>
                            </div>
                            <div>
                              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--theme-muted)' }}>
                                Summary
                              </div>
                              <p style={{ color: 'var(--theme-muted)' }}>{item.summary || 'No summary available.'}</p>
                            </div>
                            <div className="col-span-2 flex gap-2 border-t pt-3" style={{ borderColor: 'var(--theme-border)' }}>
                              <button
                                className="rounded px-3 py-1.5 text-[11px] font-medium"
                                style={{ background: 'var(--theme-hover)', color: 'var(--theme-text)' }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigator.clipboard?.writeText(item.recordPath).catch(() => {})
                                }}
                              >
                                Copy Record Path
                              </button>
                              {/* Approve / Reject / Defer / Route are illustrative-only in the
                                  approved design; Studio has no existing governed mechanism to
                                  perform these dispositions today (the governance corpus is
                                  hand-edited markdown, not backed by a Studio API/state machine).
                                  Left disabled per STUDIO-017 requirement #4 rather than inventing
                                  one — see STUDIO-017 handoff "known limitations". */}
                              <button
                                disabled
                                title="No existing governed mechanism in Studio performs this disposition — see STUDIO-017 known limitations. TODO: wire once such a mechanism exists."
                                className="cursor-not-allowed rounded px-3 py-1.5 text-[11px] font-medium opacity-40"
                                style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }}
                              >
                                Approve / Reject / Defer (not wired — no governed mechanism yet)
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
