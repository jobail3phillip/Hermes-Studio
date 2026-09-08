/**
 * New Intake dialog — Missions page header control (STUDIO-025).
 *
 * Two required fields only (title, request/intent). Submits to
 * POST /api/missions (thin wrapper around scripts/create-mission.js).
 * No CC/CX/execution-dispatch affordance here or in any success state —
 * this creates a raw Intake record only; Axi remains the Intake gate.
 */
import { useState } from 'react'
import {
  DialogRoot,
  DialogContent,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const inputStyle: React.CSSProperties = {
  background: 'var(--theme-input)',
  borderColor: 'var(--theme-border)',
  color: 'var(--theme-text)',
  border: '1px solid var(--theme-border)',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '13px',
  width: '100%',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 500,
  marginBottom: '4px',
  color: 'var(--theme-muted)',
}

interface NewIntakeDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export function NewIntakeDialog({ open, onClose, onCreated }: NewIntakeDialogProps) {
  const [title, setTitle] = useState('')
  const [requestIntent, setRequestIntent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle('')
    setRequestIntent('')
    setError(null)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit() {
    const t = title.trim()
    const r = requestIntent.trim()
    if (!t || !r) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, requestIntent: r }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string }
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? 'Failed to create intake record.')
        setSubmitting(false)
        return
      }
      reset()
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create intake record.')
      setSubmitting(false)
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="w-[min(480px,92vw)]">
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <DialogTitle>New Intake</DialogTitle>
          <DialogClose>Cancel</DialogClose>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto">
          <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
            Creates a raw Intake record for Axi to process through the normal
            gate. This does not dispatch any work.
          </p>

          <div>
            <label style={labelStyle}>Title *</label>
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short title for this intake"
              autoFocus
            />
          </div>

          <div>
            <label style={labelStyle}>Request / Intent *</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '96px' }}
              value={requestIntent}
              onChange={(e) => setRequestIntent(e.target.value)}
              placeholder="What do you want done, and why?"
              rows={4}
            />
          </div>

          {error && (
            <p className="text-xs" style={{ color: 'var(--theme-error, #dc2626)' }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <Button variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !requestIntent.trim()}
          >
            {submitting ? 'Creating…' : 'Create Intake'}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
