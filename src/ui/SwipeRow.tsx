import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A list row you can swipe left to delete.
 *
 * Deleting a cupboard used to mean tapping a "⋯" that reads as a menu, landing
 * in an edit sheet, scrolling to the bottom, then a Delete and a confirm.
 * Caspar could not find it at all, which is the correct verdict on four steps.
 *
 * Two things make this survive a real thumb rather than a mouse:
 *
 * `touch-action: pan-y` hands vertical scrolling back to the browser and keeps
 * only the horizontal axis for us. Without it the row either eats the scroll or
 * the scroll eats the swipe, depending on which moved first, and a list you
 * cannot reliably scroll is far worse than one with a buried delete.
 *
 * The gesture also refuses to start until the finger has moved further across
 * than down. Fingers travel in arcs, so a swipe that engages on the first pixel
 * of horizontal movement fires constantly while someone is just scrolling.
 *
 * The row is NARROWED rather than pushed. Sliding the whole row left is the
 * usual trick and it looked right until a real row was swiped: "Bare shelf"
 * sits at the left edge, so a 92pt push carried the entire label off screen and
 * left a red Delete button next to nothing. Shrinking the row instead keeps the
 * name anchored where it was and lets it truncate, so what you are about to
 * delete is still legible while you decide.
 */
const ACTION_W = 92
const ENGAGE = 10
const COMMIT = ACTION_W * 0.55

export function SwipeRow({
  children, onDelete, confirmLabel, disabled, openId, id, setOpenId,
}: {
  children: ReactNode
  onDelete: () => void | Promise<void>
  /** Shown after the first tap when deleting would strand something. */
  confirmLabel?: string | null
  disabled?: boolean
  /** Only one row in a list stays open; the list owns which. */
  openId: string | null
  id: string
  setOpenId: (id: string | null) => void
}) {
  const [dx, setDx] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const start = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null)
  // A row is usually tappable underneath — a cupboard expands, an item opens.
  // Without this the click that ends a swipe also fires that, so swiping to
  // delete would open the very thing you were trying to get rid of.
  const swallowClick = useRef(false)

  const open = openId === id
  useEffect(() => {
    if (!open) { setDx(0); setConfirming(false) }
    else setDx(-ACTION_W)
  }, [open])

  const down = (e: React.PointerEvent) => {
    if (disabled || busy || e.pointerType === 'mouse') return
    start.current = { x: e.clientX, y: e.clientY, axis: 'none' }
  }

  const move = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const ax = e.clientX - s.x
    const ay = e.clientY - s.y

    if (s.axis === 'none') {
      if (Math.abs(ax) < ENGAGE && Math.abs(ay) < ENGAGE) return
      // Vertical wins ties: scrolling is the far more common intent.
      s.axis = Math.abs(ax) > Math.abs(ay) ? 'x' : 'y'
      if (s.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (s.axis !== 'x') return

    const base = open ? -ACTION_W : 0
    // Closed is the floor; pulling further than the action rubber-bands.
    let next = Math.min(0, base + ax)
    if (next < -ACTION_W) next = -ACTION_W + (next + ACTION_W) * 0.25
    setDx(next)
  }

  const up = () => {
    const s = start.current
    start.current = null
    if (!s || s.axis !== 'x') return
    swallowClick.current = true
    if (dx <= -COMMIT) setOpenId(id)
    else { setOpenId(null); setDx(0) }
  }

  const remove = useCallback(async () => {
    if (confirmLabel && !confirming) { setConfirming(true); return }
    setBusy(true)
    try { await onDelete() } finally { setBusy(false); setOpenId(null) }
  }, [confirmLabel, confirming, onDelete, setOpenId])

  return (
    <div className="relative overflow-hidden">
      {/* The action sits behind and is only reachable once the row narrows.
          Confirming takes the whole row: the sentence explaining what is about
          to be stranded does not fit in a 92pt tab, and the first attempt
          clipped it to "…ems unfiled", which is worse than no warning at all. */}
      <div className="absolute inset-y-0 right-0 flex">
        {confirming ? (
          <div className="flex items-center bg-mark-red pl-3 pr-1">
            <button
              onClick={remove}
              disabled={busy}
              className="px-2 py-2 text-mini font-semibold text-white disabled:opacity-70"
            >{busy ? 'Deleting…' : confirmLabel}</button>
            <button
              onClick={() => { setConfirming(false); setOpenId(null) }}
              className="tap px-3 text-mini font-medium text-white/80"
            >Keep</button>
          </div>
        ) : (
          <button
            onClick={remove}
            disabled={busy}
            aria-label="Delete"
            style={{ width: ACTION_W }}
            className="flex items-center justify-center bg-mark-red text-mini font-semibold text-white disabled:opacity-70"
          >{busy ? '…' : 'Delete'}</button>
        )}
      </div>

      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={e => {
          if (!swallowClick.current) return
          swallowClick.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        style={{
          width: confirming ? '0px' : `calc(100% - ${Math.min(-dx, ACTION_W + 24)}px)`,
          transition: start.current?.axis === 'x' ? undefined : 'width 180ms cubic-bezier(.22,.61,.36,1)',
          touchAction: 'pan-y',
        }}
        className="relative overflow-hidden bg-ink-800"
      >
        {children}
      </div>
    </div>
  )
}
