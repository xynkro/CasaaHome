import { useEffect, useMemo, useState } from 'react'
import { useStore, locationPath } from '../store'
import { DEFAULT_CATEGORIES, UNITS, type Unit } from '../types'
import { Field, Sheet } from '../ui/primitives'

/**
 * Add an item, optionally already filed.
 *
 * The original flow only worked one way round: go to Search, tap +, then find
 * the right cupboard in a dropdown of every place in the house. That is
 * backwards from how anyone actually catalogues — you stand at an open
 * cupboard and enter what is in front of you. Passing `presetLocationId` fixes
 * the location and keeps the sheet open after each save, so a shelf can be
 * emptied into the app in one sitting without re-picking the place each time.
 */
export default function AddItem({
  open, onClose, presetLocationId, onOpenItem,
}: {
  open: boolean
  onClose: () => void
  /** When set, the item is filed here and the picker is hidden. */
  presetLocationId?: string | null
  onOpenItem?: (id: string) => void
}) {
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const saveItem = useStore(s => s.saveItem)
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const [unit, setUnit] = useState<Unit>('pcs')
  const [locationId, setLocationId] = useState('')
  const [category, setCategory] = useState('Pantry')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string[]>([])

  const pinned = presetLocationId ?? null

  useEffect(() => {
    if (!open) return
    setName(''); setQty(1); setAdded([])
    setLocationId(pinned ?? '')
  }, [open, pinned])

  const where = pinned ? locationPath(pinned, locMap, plan) : null

  const submit = async (thenClose: boolean) => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const id = await saveItem({
        name: name.trim(),
        qty, unit,
        locationId: (pinned ?? locationId) || null,
        category,
        parLevel: Math.max(qty, 1),
        minQty: 1,
      })
      setAdded(a => [name.trim(), ...a])
      setName(''); setQty(1)
      if (thenClose) { onClose(); onOpenItem?.(id) }
    } finally { setBusy(false) }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={where ? `Add to ${where.split(' ▸ ').pop()}` : 'Add an item'}
      footer={
        <div className="flex gap-2">
          <button className="btn btn-primary flex-[2]" disabled={busy || !name.trim()} onClick={() => submit(false)}>
            Add {pinned ? '· keep going' : 'another'}
          </button>
          <button className="btn btn-ghost flex-1" disabled={busy || !name.trim()} onClick={() => submit(true)}>
            Add & open
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {where && (
          <div className="rounded-lg border border-brass-500/25 bg-brass-400/8 px-3 py-2 text-xs text-brass-300">
            Filing into <span className="font-semibold">{where}</span>
          </div>
        )}

        <Field label="What is it">
          <input
            type="text"
            autoFocus
            placeholder="Jasmine rice 5kg"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(false) } }}
          />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="How many">
            <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(Number(e.target.value))} />
          </Field>
          <Field label="Unit">
            <select value={unit} onChange={e => setUnit(e.target.value as Unit)}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {DEFAULT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {!pinned && (
          <Field label="Where">
            <select value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Unfiled — sort it later</option>
              {locations
                .slice()
                .sort((a, b) => locationPath(a.id, locMap, plan).localeCompare(locationPath(b.id, locMap, plan)))
                .map(l => <option key={l.id} value={l.id}>{locationPath(l.id, locMap, plan)}</option>)}
            </select>
          </Field>
        )}

        {added.length > 0 && (
          <div className="rounded-lg bg-ink-850 px-3 py-2">
            <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-500">
              Added this session ({added.length})
            </div>
            <div className="mt-1 text-xs leading-relaxed text-ink-300">{added.join(' · ')}</div>
          </div>
        )}

        <p className="text-[0.68rem] leading-relaxed text-ink-500">
          Photos, expiry, prices and thresholds all live on the item page. Get the name
          and the shelf down first — the rest can wait.
        </p>
      </div>
    </Sheet>
  )
}
