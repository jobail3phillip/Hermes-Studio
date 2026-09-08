/**
 * Disposition dialog — Missions page row action (STUDIO-028).
 *
 * Lets HFA close/accept or hold an open Intake/Mission record. Submits to
 * POST /api/missions/:missionId/disposition (thin wrapper around
 * scripts/disposition-mission.js). Writes a new numbered governance file
 * into operations/missions/<ID>/ — same corpus, no new persistence.
 * Mirrors new-intake-dialog.tsx's shape.
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

type Disposition = 'ACCEPTED_CLOSED' | 'HELD'

const DISPOSITION_OPTIONS: Array<{ value: Disposition; label: string }> = [
  { value: 'ACCEPTED_CLOSED', label: 'Accept / Close (ACCEPTED / CLOSED)' },
  { value: 'HELD', label: 'Hold (OPEN, HELD)' },
]

interface DispositionDialogProps {
  open: boolean
  missionId: string | null
  onClose: () => void
  onDispositioned: () => void
}

export function DispositionDialog({ open, missionId, onClose, onDispositioned }: DispositionDialogProps) {
  const [disposition, setDisposition] = useState<Disposition>('ACCEPTED_CLOSED')
  const [result, setResult] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setDisposition('ACCEPTED_CLOSED')
    setResult('')
    setError(null)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!missionId) return
    const r = result.trim()
    if (!r) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/disposition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition, result: r }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Failed to write disposition record.')
        setSubmitting(false)
        return
      }
      reset()
      onDispositioned()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to write disposition record.')
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
          <DialogTitle>Disposition {missionId}</DialogTitle>
          <DialogClose>Cancel</DialogClose>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto">
          <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
            Writes a new authoritative governance record into
            operations/missions/{missionId}/. Does not edit or remove any
            existing record.
          </p>

          <div>
            <label style={labelStyle}>Disposition *</label>
            <select
              style={inputStyle}
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as Disposition)}
            >
              {DISPOSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Result *</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '96px' }}
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="Rationale / result for this disposition"
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
            disabled={submitting || !result.trim()}
          >
            {submitting ? 'Writing…' : 'Write Disposition'}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
