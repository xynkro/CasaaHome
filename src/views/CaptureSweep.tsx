import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, locationPath } from '../store'
import type { StorageLocation } from '../types'
import { uploadPhoto } from '../lib/images'
import { Sheet } from '../ui/primitives'

type ShotKind = 'closed' | 'open'

/**
 * Guided photo capture.
 *
 * Photographing twenty cupboards by hand means navigating to each one in the
 * app, remembering which you have done, and deciding what a useful photo even
 * looks like. So the app drives instead: it names the next place, says how to
 * frame it, and files the photo against the right place automatically. Ordered
 * room by room so you walk the house once.
 */

const SHOTS: Record<ShotKind, {
  label: string
  why: string
  how: string[]
}> = {
  closed: {
    label: 'Closed, from a step back',
    why: 'So you can tell which cupboard this is from across the room.',
    how: [
      'Stand roughly two metres back',
      'Get the whole unit in frame, doors shut',
      'Include a bit of the wall or the neighbouring unit for context',
    ],
  },
  open: {
    label: 'Open, square on',
    why: 'This is the one you will actually stare at when hunting for something.',
    how: [
      'Open the door fully and hold it',
      'Phone at shelf height, held level — not angled down',
      'Fill the frame with the shelves',
      'Turn the room light on rather than using flash; flash blows out labels',
    ],
  },
}

function Framing({ kind }: { kind: ShotKind }) {
  const stroke = '#6B767F'
  return (
    <svg viewBox="0 0 200 120" className="w-full" role="img" aria-label={`Framing guide: ${SHOTS[kind].label}`}>
      <rect x={1} y={1} width={198} height={118} rx={8} fill="none" stroke={stroke} strokeDasharray="5 4" />
      {kind === 'closed' ? (
        <>
          <rect x={62} y={22} width={76} height={80} rx={3} fill="#E8A33D" fillOpacity={0.22} stroke="#E8A33D" strokeWidth={2} />
          <line x1={100} y1={22} x2={100} y2={102} stroke="#E8A33D" strokeWidth={1.4} />
          <rect x={30} y={54} width={22} height={48} rx={2} fill="none" stroke={stroke} strokeWidth={1.2} />
          <rect x={148} y={54} width={22} height={48} rx={2} fill="none" stroke={stroke} strokeWidth={1.2} />
          <text x={100} y={114} fontSize={9} fill={stroke} textAnchor="middle">whole unit + a little either side</text>
        </>
      ) : (
        <>
          <rect x={24} y={16} width={152} height={86} rx={3} fill="#E8A33D" fillOpacity={0.18} stroke="#E8A33D" strokeWidth={2} />
          {[36, 58, 80].map(y => (
            <line key={y} x1={28} y1={y} x2={172} y2={y} stroke="#E8A33D" strokeWidth={1.6} strokeOpacity={0.8} />
          ))}
          <text x={100} y={114} fontSize={9} fill={stroke} textAnchor="middle">shelves fill the frame, held level</text>
        </>
      )}
    </svg>
  )
}

export interface Pending { loc: StorageLocation; kind: ShotKind }

export function pendingShots(locations: StorageLocation[]): Pending[] {
  const out: Pending[] = []
  for (const loc of locations) {
    if (!loc.shots?.closed) out.push({ loc, kind: 'closed' })
    if (!loc.shots?.open) out.push({ loc, kind: 'open' })
  }
  return out
}

export default function CaptureSweep({ open, onClose }: { open: boolean; onClose: () => void }) {
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const saveLocation = useStore(s => s.saveLocation)
  const fileRef = useRef<HTMLInputElement>(null)

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  // Walk in physical order: everything in one room, then the next.
  const queue = useMemo(() => {
    const rank = (l: StorageLocation) => locationPath(l.id, locMap, plan)
    return pendingShots([...locations].sort((a, b) => {
      const pa = rank(a), pb = rank(b)
      return pa === pb ? a.name.localeCompare(b.name) : pa.localeCompare(pb)
    }))
  }, [locations, locMap, plan])

  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  useEffect(() => { if (open) { setIdx(0); setDone(0) } }, [open])
  if (!open) return null

  const cur = queue[idx]
  const next = () => setIdx(i => i + 1)

  const take = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || !cur) return
    setBusy(true)
    try {
      const url = await uploadPhoto(file, 'locations', `${cur.loc.name}-${cur.kind}`)
      await saveLocation({
        id: cur.loc.id,
        shots: { ...(cur.loc.shots ?? {}), [cur.kind]: url },
      })
      setDone(d => d + 1)
      next()
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!cur) {
    return (
      <Sheet open onClose={onClose} title="Photo sweep">
        <div className="py-8 text-center">
          <div className="text-3xl">📷</div>
          <p className="mt-2 text-sm font-medium text-ink-200">
            {done > 0 ? 'Sweep complete' : 'Every place already has both shots'}
          </p>
          {done > 0 && <p className="mt-1 text-xs text-ink-400">{done} photo{done === 1 ? '' : 's'} added.</p>}
          <button className="btn btn-primary mt-5" onClick={onClose}>Done</button>
        </div>
      </Sheet>
    )
  }

  const spec = SHOTS[cur.kind]
  const where = locationPath(cur.loc.id, locMap, plan)
  const prevWhere = idx > 0 ? locationPath(queue[idx - 1].loc.id, locMap, plan) : null

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <div className="flex w-full items-center gap-2">
          <span>Photo sweep</span>
          <span className="tnum text-[0.7rem] font-normal text-ink-500">{idx + 1} / {queue.length}</span>
        </div>
      }
      footer={
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={next} disabled={busy}>Skip</button>
          <button className="btn btn-primary flex-1" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Saving…' : '📷 Take the photo'}
          </button>
        </div>
      }
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
        <div className="h-full bg-brass-400 transition-all" style={{ width: `${(idx / queue.length) * 100}%` }} />
      </div>

      {where !== prevWhere && (
        <div className="mt-4 rounded-lg border border-brass-500/25 bg-brass-400/8 px-3 py-2 text-xs text-brass-300">
          Go to <span className="font-semibold">{where}</span>
        </div>
      )}

      <div className="mt-4">
        <div className="text-base font-semibold text-ink-200">{cur.loc.name}</div>
        <div className="mt-0.5 text-xs text-ink-400">{spec.label}</div>
      </div>

      <div className="panel mt-3 px-3 py-3">
        <Framing kind={cur.kind} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-300">{spec.why}</p>
      <ul className="mt-2 space-y-1">
        {spec.how.map(h => (
          <li key={h} className="flex gap-2 text-xs leading-relaxed text-ink-400">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brass-400" />{h}
          </li>
        ))}
      </ul>

      {cur.kind === 'open' && cur.loc.shots?.closed && (
        <div className="mt-3">
          <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-ink-500">
            You are at the right one if it looks like this
          </div>
          <img src={cur.loc.shots.closed} alt="" className="h-28 rounded-xl object-cover" />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => take(e.target.files)}
      />
    </Sheet>
  )
}
