import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { LOCATION_KINDS, type LocationKind, type StorageLocation } from '../types'
import { stockStatus, STATUS_ORDER } from '../lib/stock'
import { uploadPhoto, deletePhoto } from '../lib/images'
import { Empty, Field, Sheet, StatusChip } from '../ui/primitives'
import { ItemRow } from '../ui/ItemRow'
import CaptureSweep, { pendingShots } from './CaptureSweep'
import type { StockStatus } from '../types'

const KIND_ICON: Record<LocationKind, string> = {
  cabinet: '▤', drawer: '▭', shelf: '▬', fridge: '❄', freezer: '✻',
  wardrobe: '▥', store: '📦', box: '◰', rack: '▦', other: '·',
}

export default function LocationsView({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const locations = useStore(s => s.locations)
  const items = useStore(s => s.items)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)

  const [editing, setEditing] = useState<StorageLocation | 'new' | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sweep, setSweep] = useState(false)

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  const itemsByLoc = useMemo(() => {
    const m = new Map<string, typeof items>()
    for (const i of items) {
      if (i.archived) continue
      const k = i.locationId ?? '__unfiled'
      const arr = m.get(k) ?? []
      arr.push(i)
      m.set(k, arr)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const sa = STATUS_ORDER[stockStatus(a, settings) as StockStatus]
        const sb = STATUS_ORDER[stockStatus(b, settings) as StockStatus]
        return sa === sb ? a.name.localeCompare(b.name) : sa - sb
      })
    }
    return m
  }, [items, settings])

  /** Worst status anywhere inside a place (including nested children). */
  const worstStatus = useMemo(() => {
    const childrenOf = new Map<string, string[]>()
    for (const l of locations) {
      if (!l.parentId) continue
      childrenOf.set(l.parentId, [...(childrenOf.get(l.parentId) ?? []), l.id])
    }
    const memo = new Map<string, StockStatus>()
    const walk = (id: string, depth = 0): StockStatus => {
      if (memo.has(id)) return memo.get(id)!
      if (depth > 8) return 'ok'
      let worst: StockStatus = 'ok'
      for (const i of itemsByLoc.get(id) ?? []) {
        const s = stockStatus(i, settings)
        if (STATUS_ORDER[s] < STATUS_ORDER[worst]) worst = s
      }
      for (const c of childrenOf.get(id) ?? []) {
        const s = walk(c, depth + 1)
        if (STATUS_ORDER[s] < STATUS_ORDER[worst]) worst = s
      }
      memo.set(id, worst)
      return worst
    }
    const out = new Map<string, StockStatus>()
    for (const l of locations) out.set(l.id, walk(l.id))
    return out
  }, [locations, itemsByLoc, settings])

  const roots = useMemo(
    () => locations.filter(l => !l.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
  )
  const childrenOf = (id: string) =>
    locations.filter(l => l.parentId === id).sort((a, b) => a.name.localeCompare(b.name))

  const byRoom = useMemo(() => {
    const groups = new Map<string, StorageLocation[]>()
    for (const l of roots) {
      const key = l.roomId ?? '__none'
      groups.set(key, [...(groups.get(key) ?? []), l])
    }
    return groups
  }, [roots])

  const unfiled = itemsByLoc.get('__unfiled') ?? []
  const missingShots = useMemo(() => pendingShots(locations).length, [locations])

  const renderPlace = (loc: StorageLocation, depth: number) => {
    const kids = childrenOf(loc.id)
    const own = itemsByLoc.get(loc.id) ?? []
    const isOpen = expanded[loc.id]
    const worst = worstStatus.get(loc.id) ?? 'ok'
    const total = own.length + kids.reduce((a, k) => a + (itemsByLoc.get(k.id)?.length ?? 0), 0)

    return (
      <div key={loc.id}>
        <div
          className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-2.5"
          style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setExpanded(e => ({ ...e, [loc.id]: !e[loc.id] }))}
          >
            <span className="w-4 shrink-0 text-center text-ink-500">{KIND_ICON[loc.kind]}</span>
            <span className="truncate text-sm font-medium text-ink-200">{loc.name}</span>
            {loc.longTerm && (
              <span className="chip shrink-0 border-ink-600 bg-ink-800 text-[0.6rem] text-ink-400">long-term</span>
            )}
            {worst !== 'ok' && <StatusChip status={worst} small />}
          </button>
          <span className="tnum shrink-0 text-[0.7rem] text-ink-500">{total}</span>
          <button
            className="shrink-0 px-1 text-ink-500 hover:text-brass-400"
            onClick={() => setEditing(loc)}
            aria-label={`Edit ${loc.name}`}
          >⋯</button>
        </div>

        {isOpen && (
          <div className="bg-ink-850/50">
            {own.map(i => (
              <ItemRow key={i.id} item={i} settings={settings} locMap={locMap} plan={plan} onOpen={onOpenItem} dense />
            ))}
            {own.length === 0 && kids.length === 0 && (
              <div className="px-4 py-3 text-center text-[0.7rem] text-ink-500">Empty</div>
            )}
            {kids.map(k => renderPlace(k, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-ink-200">Places</h1>
        <div className="flex items-center gap-3">
          <Link to="/plan" className="text-[0.7rem] font-semibold text-brass-400 hover:text-brass-300">Floorplan →</Link>
          <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => setEditing('new')}>+ Place</button>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Cupboards, drawers, the store room. Nest them — a cabinet can hold shelves, a shelf can hold boxes.
      </p>

      {missingShots > 0 && (
        <button
          onClick={() => setSweep(true)}
          className="panel mt-3 flex w-full items-center gap-3 px-3 py-3 text-left transition hover:border-brass-500/50"
        >
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brass-400/12 text-brass-400">📷</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink-200">Run a photo sweep</div>
            <div className="truncate text-[0.7rem] text-ink-400">
              {missingShots} shot{missingShots === 1 ? '' : 's'} still wanted — the app tells you which place and how to frame it
            </div>
          </div>
          <span className="text-ink-500">→</span>
        </button>
      )}

      {locations.length === 0 ? (
        <div className="mt-5">
          <Empty
            icon="▤"
            title="No places yet"
            hint="Add the big ones first: Kitchen tall cabinet, Store room, Fridge. You can subdivide later."
            action={<button className="btn btn-primary" onClick={() => setEditing('new')}>Add first place</button>}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {[...byRoom.entries()].map(([roomId, places]) => {
            const room = plan.rooms.find(r => r.id === roomId)
            return (
              <section key={roomId} className="panel overflow-hidden">
                <header className="border-b border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
                  {room?.name ?? 'No room assigned'}
                </header>
                {places.map(l => renderPlace(l, 0))}
              </section>
            )
          })}

          {unfiled.length > 0 && (
            <section className="panel overflow-hidden">
              <header className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Unfiled</span>
                <span className="tnum text-[0.7rem] text-ink-500">{unfiled.length}</span>
              </header>
              {unfiled.map(i => (
                <ItemRow key={i.id} item={i} settings={settings} locMap={locMap} plan={plan} onOpen={onOpenItem} dense />
              ))}
            </section>
          )}
        </div>
      )}

      <PlaceEditor
        target={editing}
        onClose={() => setEditing(null)}
      />

      <CaptureSweep open={sweep} onClose={() => setSweep(false)} />
    </div>
  )
}

function PlaceEditor({ target, onClose }: { target: StorageLocation | 'new' | null; onClose: () => void }) {
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const saveLocation = useStore(s => s.saveLocation)
  const deleteLocation = useStore(s => s.deleteLocation)
  const fileRef = useRef<HTMLInputElement>(null)

  const existing = target !== 'new' && target !== null ? target : null
  const [d, setD] = useState<Partial<StorageLocation>>({})
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const key = existing?.id ?? 'new'
  const seedRef = useRef(key)
  if (seedRef.current !== key) { seedRef.current = key; if (Object.keys(d).length) setD({}) }

  if (!target) return null

  const v = <K extends keyof StorageLocation>(k: K): StorageLocation[K] | undefined =>
    d[k] !== undefined ? (d[k] as StorageLocation[K]) : existing?.[k]
  const set = <K extends keyof StorageLocation>(k: K, val: StorageLocation[K]) =>
    setD(p => ({ ...p, [k]: val }))

  const addPhoto = async (files: FileList | null) => {
    if (!files?.length || !existing) return
    setBusy(true)
    try {
      const url = await uploadPhoto(files[0], 'locations', existing.name)
      await saveLocation({ id: existing.id, photoUrls: [...(existing.photoUrls ?? []), url] })
    } finally { setBusy(false) }
  }

  const submit = async () => {
    setBusy(true)
    try {
      await saveLocation(existing ? { id: existing.id, ...d } : d)
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'New place'}
      footer={
        <button className="btn btn-primary w-full" disabled={busy || (!existing && !v('name'))} onClick={submit}>
          {existing ? 'Save' : 'Create place'}
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Name" hint="be specific">
          <input
            type="text"
            autoFocus={!existing}
            placeholder="Kitchen tall cabinet — top shelf"
            value={v('name') ?? ''}
            onChange={e => set('name', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind">
            <select value={v('kind') ?? 'cabinet'} onChange={e => set('kind', e.target.value as LocationKind)}>
              {LOCATION_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Room">
            <select value={v('roomId') ?? ''} onChange={e => set('roomId', e.target.value || null)}>
              <option value="">—</option>
              {plan.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Inside" hint="nest under another place">
          <select value={v('parentId') ?? ''} onChange={e => set('parentId', e.target.value || null)}>
            <option value="">Nothing — it is a top-level place</option>
            {locations
              .filter(l => l.id !== existing?.id)
              .map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[#E8A33D]"
            checked={!!v('longTerm')}
            onChange={e => set('longTerm', e.target.checked)}
          />
          <span className="text-xs">
            <span className="font-medium text-ink-200">Long-term storage</span>
            <span className="mt-0.5 block leading-relaxed text-ink-400">
              Things here get a “you forgot about this” nudge on Telegram. Items tagged seasonal are always exempt,
              so winter gear and luggage stay quiet.
            </span>
          </span>
        </label>

        <Field label="Notes"><textarea rows={2} value={v('notes') ?? ''} onChange={e => set('notes', e.target.value)} /></Field>

        {existing && (
          <div>
            <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">Photos</div>
            <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
              {(existing.photoUrls ?? []).map(url => (
                <div key={url} className="relative shrink-0">
                  <img src={url} alt="" className="size-24 rounded-xl object-cover" />
                  <button
                    onClick={async () => {
                      await saveLocation({ id: existing.id, photoUrls: existing.photoUrls.filter(u => u !== url) })
                      void deletePhoto(url)
                    }}
                    className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-[0.6rem]"
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-ink-600 text-xs text-ink-400"
              >📷 Add</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => addPhoto(e.target.files)} />
          </div>
        )}

        {existing && (
          <div className="border-t border-ink-700 pt-3">
            {confirmDel ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-ink-400">Delete this place? Items inside become unfiled.</span>
                <button className="btn btn-ghost text-xs" onClick={() => setConfirmDel(false)}>Keep</button>
                <button
                  className="btn btn-danger text-xs"
                  onClick={async () => { await deleteLocation(existing.id); onClose() }}
                >Delete</button>
              </div>
            ) : (
              <button className="btn btn-ghost text-xs text-ink-400" onClick={() => setConfirmDel(true)}>Delete place</button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
