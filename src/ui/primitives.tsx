import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StockStatus } from '../types'
import { STATUS_META } from '../lib/stock'

export function StatusChip({ status, small }: { status: StockStatus; small?: boolean }) {
  const m = STATUS_META[status]
  return (
    <span className={`chip ${m.cls} ${small ? 'text-micro px-1.5' : ''}`}>
      <span className={`inline-block rounded-full ${m.dot} ${small ? 'size-1' : 'size-1.5'}`} />
      {m.label}
    </span>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-mini font-medium text-ink-400">{label}</span>
        {hint && <span className="text-micro text-ink-500">{hint}</span>}
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
  const [kb, setKb] = useState(0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)

    // Locking <body> did nothing: body is pinned to height:100% and never
    // scrolls. The real scroller is <main>, so the list kept moving behind
    // every open sheet.
    const main = document.querySelector('main')
    const prev = main?.style.overflow
    if (main) main.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      if (main) main.style.overflow = prev ?? ''
    }
  }, [open, onClose])

  /**
   * iOS shrinks only the visual viewport when the keyboard opens; the layout
   * viewport, and therefore anything position:fixed, does not move. The sheet
   * is bottom-anchored, so its footer — which holds Add and Save — sat under
   * the keyboard on every sheet that autofocuses a field.
   */
  useEffect(() => {
    const vv = window.visualViewport
    if (!open || !vv) return
    const sync = () => setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    sync()
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      setKb(0)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* This scrim fires every time anyone corrects a count — the app's primary
          interaction — so 65% black over a pale app was a blackout many times
          a day. */}
      <div className="absolute inset-0 bg-ink-200/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className={`sheet-up relative flex w-full flex-col border border-ink-700 bg-ink-850 shadow-2xl
          sm:rounded-2xl rounded-t-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        // A sheet is fixed to the viewport, so it is not covered by the #root
        // inset and would otherwise slide its header under the island.
        style={{ maxHeight: `calc(92dvh - var(--safe-t) - ${kb}px)`, marginBottom: kb }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <div className="min-w-0 text-sm font-semibold text-ink-200">{title}</div>
          <button className="tap btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>Close</button>
        </div>
        <div
          className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          // Without a footer the body is the last child, so it owns the inset
          // that keeps the final button clear of the home indicator.
          style={footer ? undefined : { paddingBottom: 'calc(1rem + var(--safe-b))' }}
        >{children}</div>
        {footer && (
          <div
            className="shrink-0 border-t border-ink-700 px-4 py-3"
            style={{ paddingBottom: kb > 0 ? '0.75rem' : 'calc(0.75rem + var(--safe-b))' }}
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
    warn: 'text-mark-ochre',
    bad: 'text-mark-red',
    good: 'text-mark-leaf',
  }
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      // Four small bordered cards in a row is the literal shape of a SaaS KPI
      // strip. One ruled panel, cells divided by a seam.
      className="flex flex-1 flex-col items-start gap-0.5 border-l border-ink-700 px-3 py-2.5 text-left first:border-l-0 disabled:cursor-default"
    >
      <div className={`tnum text-xl font-semibold leading-none ${tones[tone]}`}>{value}</div>
      <div className="text-micro font-medium text-ink-400">{label}</div>
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
          className="tnum h-full text-center text-[22px] font-semibold"
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
