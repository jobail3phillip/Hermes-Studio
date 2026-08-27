'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { AGENT_PERSONAS } from '@/lib/agent-personas'
import { fetchAgents } from '@/lib/agents-api'
import type { AgentDefinition } from '@/types/agent'
import type { CreateCrewInput, CrewMemberRole } from '@/lib/crews-api'
import { cn } from '@/lib/utils'

const ROLES: Array<{ value: CrewMemberRole; label: string }> = [
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'executor', label: 'Executor' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'specialist', label: 'Specialist' },
]

type MemberDraft = {
  persona: string
  role: CrewMemberRole
}

function getInitialMembers(agentOptions: AgentDefinition[]): MemberDraft[] {
  if (agentOptions.length >= 2) {
    return [
      { persona: agentOptions[0].name.toLowerCase(), role: 'coordinator' },
      { persona: agentOptions[1].name.toLowerCase(), role: 'executor' },
    ]
  }
  if (agentOptions.length === 1) {
    return [{ persona: agentOptions[0].name.toLowerCase(), role: 'coordinator' }]
  }
  return []
}

type Props = {
  open: boolean
  isSubmitting?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CreateCrewInput) => void | Promise<void>
  initialName?: string
  initialGoal?: string
  initialMembers?: Array<{ persona: string; role: CrewMemberRole }>
}

export function CreateCrewDialog({
  open,
  isSubmitting = false,
  onOpenChange,
  onSubmit,
  initialName,
  initialGoal,
  initialMembers,
}: Props) {
  // Fetch full agent list (built-ins + custom, workspace-scoped)
  const { data: allAgents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    enabled: open,
    staleTime: 30_000,
  })

  // Merge AGENT_PERSONAS display info with custom agents for picker options
  const agentOptions = allAgents.length > 0
    ? allAgents
    : AGENT_PERSONAS.map((p): AgentDefinition => ({
        id: `builtin-${p.name.toLowerCase()}`,
        name: p.name,
        emoji: p.emoji,
        color: p.color,
        roleLabel: p.role,
        systemPrompt: '',
        model: null,
        tags: [],
        isBuiltIn: true,
        createdAt: 0,
        updatedAt: 0,
      }))

  const [name, setName] = useState(initialName ?? '')
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [members, setMembers] = useState<MemberDraft[]>(
    initialMembers ?? getInitialMembers(agentOptions),
  )

  useEffect(() => {
    if (!open) {
      setName(initialName ?? '')
      setGoal(initialGoal ?? '')
      setMembers(initialMembers ?? getInitialMembers(agentOptions))
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange, initialName, initialGoal, initialMembers]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  function addMember() {
    if (members.length >= 8) return
    const taken = new Set(members.map((m) => m.persona))
    const next = agentOptions.find((a) => !taken.has(a.name.toLowerCase()))
    setMembers((prev) => [
      ...prev,
      { persona: next?.name.toLowerCase() ?? agentOptions[0]?.name.toLowerCase() ?? '', role: 'executor' },
    ])
  }

  function removeMember(idx: number) {
    setMembers((prev) => prev.filter((_, i) => i !== idx))
  }

  function setMemberField<K extends keyof MemberDraft>(
    idx: number,
    key: K,
    value: MemberDraft[K],
  ) {
    setMembers((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [key]: value } : m)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || members.length === 0) return
    await onSubmit({ name: name.trim(), goal: goal.trim(), members })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--theme-text)]">
            New Crew
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--theme-muted)]">
              Crew name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product Launch Team"
              required
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            />
          </div>

          {/* Goal */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--theme-muted)]">
              Goal{' '}
              <span className="font-normal opacity-60">(optional)</span>
            </label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="What should this crew accomplish?"
              className="w-full resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            />
          </div>

          {/* Members */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--theme-muted)]">
                Agents ({members.length}/8)
              </span>
              {members.length < 8 && (
                <button
                  type="button"
                  onClick={addMember}
                  className="text-xs text-[var(--theme-accent)] hover:underline"
                >
                  + Add agent
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {members.map((member, idx) => {
                const agent = agentOptions.find(
                  (a) => a.name.toLowerCase() === member.persona,
                )
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-2"
                  >
                    {/* Persona picker */}
                    <select
                      value={member.persona}
                      onChange={(e) =>
                        setMemberField(idx, 'persona', e.target.value)
                      }
                      className="flex-1 rounded border-0 bg-transparent text-sm text-[var(--theme-text)] focus:outline-none cursor-pointer"
                    >
                      {agentOptions.some((a) => !a.isBuiltIn) ? (
                        <>
                          <optgroup label="Built-in" className="bg-[var(--theme-bg)]">
                            {agentOptions.filter((a) => a.isBuiltIn).map((a) => (
                              <option
                                key={a.id}
                                value={a.name.toLowerCase()}
                                className="bg-[var(--theme-bg)]"
                              >
                                {a.emoji} {a.name} — {a.roleLabel}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Custom" className="bg-[var(--theme-bg)]">
                            {agentOptions.filter((a) => !a.isBuiltIn).map((a) => (
                              <option
                                key={a.id}
                                value={a.name.toLowerCase()}
                                className="bg-[var(--theme-bg)]"
                              >
                                {a.emoji} {a.name} — {a.roleLabel}
                              </option>
                            ))}
                          </optgroup>
                        </>
                      ) : (
                        agentOptions.map((a) => (
                          <option
                            key={a.id}
                            value={a.name.toLowerCase()}
                            className="bg-[var(--theme-bg)]"
                          >
                            {a.emoji} {a.name} — {a.roleLabel}
                          </option>
                        ))
                      )}
                    </select>

                    {/* Role picker */}
                    <select
                      value={member.role}
                      onChange={(e) =>
                        setMemberField(
                          idx,
                          'role',
                          e.target.value as CrewMemberRole,
                        )
                      }
                      className="rounded border-0 bg-transparent text-xs text-[var(--theme-muted)] focus:outline-none cursor-pointer"
                    >
                      {ROLES.map((r) => (
                        <option
                          key={r.value}
                          value={r.value}
                          className="bg-[var(--theme-bg)]"
                        >
                          {r.label}
                        </option>
                      ))}
                    </select>

                    {/* Color swatch */}
                    {agent && (
                      <span className={cn('text-base', agent.color)}>
                        {agent.emoji}
                      </span>
                    )}

                    {/* Remove */}
                    {members.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMember(idx)}
                        className="rounded p-1 text-[var(--theme-muted)] hover:text-[var(--theme-danger)] transition-colors"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
              {isSubmitting ? 'Creating…' : 'Create Crew'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
