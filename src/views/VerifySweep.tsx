import { useEffect, useMemo, useState } from 'react'
import { useStore, locationPath } from '../store'
import type { Item } from '../types'
import { daysBetween } from '../lib/stock'
import { QtyStepper, Sheet } from '../ui/primitives'

/**
 * Requirement 3, done properly.
 *
 * Nobody reliably logs consumption. What people WILL do is open a cupboard,
 * see two bottles where the app claimed ten, and want to fix it in one tap.
 * The sweep walks you shelf by shelf so correcting a whole cupboard takes
 * thirty seconds — grouped by location, because that is the order you
 * physically encounter things in.
 */
export default function VerifySweep({
  open, onClose, candidates,
}: { open: boolean; onClose: () => void; candidates: Item[] }) {
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const setQty = useStore(s => s.setQty)
  const verifyItem = useStore(s => s.verifyItem)

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  // Walk in physical order: everything in one cupboard, then the next.
  const queue = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const pa = locationPath(a.locationId, locMap, plan)
      const pb = locationPath(b.locationId, locMap, plan)
      return pa === pb ? a.name.localeCompare(b.name) : pa.localeCompare(pb)
    })
  }, [candidates, locMap, plan])

  const [idx, setIdx] = useState(0)
  const [draft, setDraft] = useState(0)
  const [done, setDone] = useState(0)
  const [corrected, setCorrected] = useState(0)

  const current = queue[idx]

  useEffect(() => { if (open) { setIdx(0); setDone(0); setCorrected(0) } }, [open])
  useEffect(() => { if (current) setDraft(current.qty) }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const finish = () => onClose()

  const next = () => {
    if (idx + 1 >= queue.length) finish()
    else setIdx(i => i + 1)
  }

  const confirmSame = async () => {
    if (!current) return
    await verifyItem(current.id)
    setDone(d => d + 1)
    next()
  }

  const applyChange = async () => {
    if (!current) return
    await setQty(current.id, draft)
    setDone(d => d + 1)
    setCorrected(c => c + 1)
    next()
  }

  if (!current) {
    return (
      <Sheet open onClose={finish} title="Verify sweep">
        <div className="py-8 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm font-medium text-ink-200">Sweep complete</p>
          <p className="mt-1 text-xs text-ink-400">
            {done} checked{corrected > 0 ? `, ${corrected} corrected` : ', all counts were right'}.
          </p>
          <button className="btn btn-primary mt-5" onClick={finish}>Done</button>
        </div>
      </Sheet>
    )
  }

  const where = locationPath(current.locationId, locMap, plan)
  const prevWhere = idx > 0 ? locationPath(queue[idx - 1].locationId, locMap, plan) : null
  const newSection = where !== prevWhere

  return (
    <Sheet
      open
      onClose={finish}
      title={
        <div className="flex w-full items-center gap-2">
          <span>Verify sweep</span>
          <span className="tnum text-[0.7rem] font-normal text-ink-500">{idx + 1} / {queue.length}</span>
        </div>
      }
      footer={
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={next}>Skip</button>
          {draft === current.qty ? (
            <button className="btn btn-primary flex-1" onClick={confirmSame}>
              Yes, {current.qty} {current.unit}
            </button>
          ) : (
            <button className="btn btn-primary flex-1" onClick={applyChange}>
              Correct to {draft} {current.unit}
            </button>
          )}
        </div>
      }
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full bg-brass-400 transition-all"
          style={{ width: `${(idx / queue.length) * 100}%` }}
        />
      </div>

      {newSection && (
        <div className="mt-4 rounded-lg border border-brass-500/25 bg-brass-400/8 px-3 py-2 text-xs text-brass-300">
          Go to <span className="font-semibold">{where}</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        {current.photoUrls?.[0] ? (
          <img src={current.photoUrls[0]} alt="" className="size-20 rounded-xl object-cover" />
        ) : (
          <div className="grid size-20 place-items-center rounded-xl bg-ink-700/60 text-2xl text-ink-500">
            {current.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink-200">
            {current.brand && <span className="text-ink-400">{current.brand} </span>}{current.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-400">{where}</div>
          <div className="mt-0.5 text-[0.7rem] text-ink-500">
            last checked {current.lastVerifiedAt ? `${Math.round(daysBetween(current.lastVerifiedAt))}d ago` : 'never'}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-center text-sm text-ink-300">
          App says <span className="tnum font-semibold text-ink-200">{current.qty} {current.unit}</span>. What do you see?
        </div>
        <QtyStepper value={draft} onChange={setDraft} unit={current.unit} />
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {[0, 1, 2, 3, 5].map(n => (
          <button key={n} className="btn btn-ghost tnum px-3 py-1.5 text-xs" onClick={() => setDraft(n)}>{n}</button>
        ))}
      </div>
    </Sheet>
  )
}
