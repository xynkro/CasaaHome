import { useEffect, useRef, type ReactNode } from 'react'
import type { StockStatus } from '../types'
import { STATUS_META } from '../lib/stock'

export function StatusChip({ status, small }: { status: StockStatus; small?: boolean }) {
  const m = STATUS_META[status]
  return (
    <span className={`chip ${m.cls} ${small ? 'text-[0.6rem] px-1.5' : ''}`}>
      <span className={`inline-block rounded-full ${m.dot} ${small ? 'size-1' : 'size-1.5'}`} />
      {m.label}
    </span>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">{label}</span>
        {hint && <span className="text-[0.65rem] text-ink-500">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

export function Sheet({
  open, onClose, title, children, footer, wide,
}: {
  open: boolean; onClose: () => void; title: ReactNode
  children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className={`sheet-up relative flex max-h-[92dvh] w-full flex-col border border-ink-700 bg-ink-850 shadow-2xl
          sm:max-h-[86dvh] sm:rounded-2xl rounded-t-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <div className="min-w-0 text-sm font-semibold text-ink-200">{title}</div>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div
            className="shrink-0 border-t border-ink-700 px-4 py-3"
            style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Empty({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-3xl opacity-60">{icon}</div>
      <div className="text-sm font-semibold text-ink-200">{title}</div>
      {hint && <div className="max-w-xs text-xs leading-relaxed text-ink-400">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Stat({ value, label, tone = 'default', onClick }: {
  value: ReactNode; label: string
  tone?: 'default' | 'warn' | 'bad' | 'good'
  onClick?: () => void
}) {
  const tones = {
    default: 'text-ink-200',
    warn: 'text-amber-300',
    bad: 'text-rose-300',
    good: 'text-emerald-300',
  }
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="panel flex flex-col items-start gap-0.5 px-3 py-2.5 text-left transition enabled:hover:border-ink-500 disabled:cursor-default"
    >
      <div className={`tnum text-xl font-semibold leading-none ${tones[tone]}`}>{value}</div>
      <div className="text-[0.65rem] font-medium uppercase tracking-wider text-ink-400">{label}</div>
    </button>
  )
}

/** Big, thumb-sized stepper. This is the most-used control in the app. */
export function QtyStepper({
  value, onChange, unit, step = 1,
}: { value: number; onChange: (n: number) => void; unit?: string; step?: number }) {
  return (
    <div className="flex items-stretch gap-2">
      <button
        className="btn btn-ghost w-12 text-lg"
        onClick={() => onChange(Math.max(0, +(value - step).toFixed(2)))}
        aria-label="Decrease"
      >−</button>
      <div className="relative flex-1">
        <input
          type="number"
          inputMode="decimal"
          className="tnum h-full text-center text-lg font-semibold"
          value={Number.isFinite(value) ? value : 0}
          onChange={e => onChange(Math.max(0, Number(e.target.value)))}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-500">
            {unit}
          </span>
        )}
      </div>
      <button
        className="btn btn-ghost w-12 text-lg"
        onClick={() => onChange(+(value + step).toFixed(2))}
        aria-label="Increase"
      >+</button>
    </div>
  )
}
