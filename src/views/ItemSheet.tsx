import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useStore, locationPath } from '../store'
import {
  DEFAULT_CATEGORIES, STORES, UNITS,
  type Currency, type Item, type PriceRef, type StockEvent, type StoreKey, type Unit,
} from '../types'
import { fmtCover, stockStatus, daysBetween, daysUntil } from '../lib/stock'
import { cheapestRef, storeSearchUrl, storeShort } from '../lib/links'
import { uploadPhoto, deletePhoto } from '../lib/images'
import { Field, QtyStepper, Sheet, StatusChip } from '../ui/primitives'

export default function ItemSheet({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)
  const setQty = useStore(s => s.setQty)
  const saveItem = useStore(s => s.saveItem)
  const deleteItem = useStore(s => s.deleteItem)

  const item = items.find(i => i.id === itemId) ?? null
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  const [draftQty, setDraftQty] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (item) { setDraftQty(item.qty); setEditing(false); setConfirmDelete(false) }
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <Sheet open={false} onClose={onClose} title=""><span /></Sheet>

  const status = stockStatus(item, settings)
  const changed = draftQty !== item.qty
  const history: StockEvent[] = ((item as Item & { history?: StockEvent[] }).history ?? []).slice().reverse()
  const cover = fmtCover(item)
  const expiryIn = daysUntil(item.expiryDate)
  const best = cheapestRef(item.priceRefs ?? [], settings)

  const commit = async (type?: 'restock') => {
    setBusy(true)
    try { await setQty(item.id, draftQty, type) } finally { setBusy(false) }
  }

  const quickUse = async (n: number) => {
    const next = Math.max(0, item.qty - n)
    setDraftQty(next)
    setBusy(true)
    try { await setQty(item.id, next, 'use') } finally { setBusy(false) }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={
        <div className="flex items-center gap-2">
          <span className="truncate">{item.name}</span>
          <StatusChip status={status} small />
        </div>
      }
      footer={
        changed ? (
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setDraftQty(item.qty)}>Cancel</button>
            <button className="btn btn-primary flex-[2]" disabled={busy} onClick={() => commit(draftQty > item.qty ? 'restock' : undefined)}>
              {draftQty > item.qty ? `Restocked to ${draftQty}` : `Correct to ${draftQty} ${item.unit}`}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => quickUse(1)} disabled={busy || item.qty <= 0}>Used 1</button>
            <button
              className="btn btn-ghost flex-1"
              onClick={() => useStore.getState().verifyItem(item.id)}
              disabled={busy}
            >
              Count is right
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(e => !e)}>
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
        )
      }
    >
      {/* --- the count, front and centre ---------------------------------- */}
      <div className="panel px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">
            How many are actually there?
          </span>
          {cover && <span className="text-[0.7rem] text-ink-400">{cover}</span>}
        </div>
        <QtyStepper value={draftQty} onChange={setDraftQty} unit={item.unit} />
        <div className="mt-2 flex items-center justify-between text-[0.68rem] text-ink-500">
          <span>
            App thinks <span className="tnum text-ink-300">{item.qty}</span> · min {item.minQty} · par {item.parLevel}
          </span>
          {item.lastVerifiedAt && <span>checked {Math.round(daysBetween(item.lastVerifiedAt))}d ago</span>}
        </div>
      </div>

      {/* --- facts -------------------------------------------------------- */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Fact label="Where" value={locationPath(item.locationId, locMap, plan)} />
        <Fact label="Category" value={item.category} />
        {item.expiryDate && (
          <Fact
            label="Expires"
            value={`${new Date(item.expiryDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: '2-digit' })}${
              expiryIn !== null ? ` · ${expiryIn < 0 ? `${Math.abs(Math.round(expiryIn))}d ago` : `in ${Math.round(expiryIn)}d`}` : ''
            }`}
            tone={expiryIn !== null && expiryIn <= settings.expiryWarnDays ? 'warn' : undefined}
          />
        )}
        {best && (
          <Fact label="Best price" value={`S$${best.sgd.toFixed(2)} at ${storeShort(best.ref.store)}`} />
        )}
        {item.burnPerDay ? (
          <Fact label="Usage" value={`~${(item.burnPerDay * 7).toFixed(1)} ${item.unit}/week`} />
        ) : null}
        {item.seasonal && <Fact label="Seasonal" value="Excluded from use-it-up nudges" />}
      </dl>

      {item.tags?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map(t => (
            <span key={t} className="chip border-ink-600 bg-ink-800 text-ink-300">{t}</span>
          ))}
        </div>
      )}

      {item.notes && <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-ink-300">{item.notes}</p>}

      <Photos item={item} onSave={saveItem} />

      <TelegramActions item={item} />

      <div className="mt-3 flex flex-wrap gap-2">
        {(['shopee', 'ntuc', 'giant_jb'] as StoreKey[]).map(s => {
          const url = storeSearchUrl(s, item)
          if (!url) return null
          return (
            <a key={s} href={url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost text-xs">
              {storeShort(s)} ↗
            </a>
          )
        })}
      </div>

      {editing && (
        <EditForm
          item={item}
          onSave={async patch => { await saveItem({ id: item.id, ...patch }) }}
        />
      )}

      {history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">
            History ({history.length})
          </summary>
          <ul className="mt-2 divide-y divide-ink-700/60 text-xs">
            {history.map(h => (
              <li key={h.id} className="flex items-center gap-2 py-1.5">
                <span className={`tnum w-10 text-right font-semibold ${h.delta > 0 ? 'text-emerald-300' : 'text-ink-300'}`}>
                  {h.delta > 0 ? '+' : ''}{h.delta}
                </span>
                <span className="w-20 shrink-0 text-ink-500">{h.type}</span>
                <span className="tnum flex-1 text-ink-400">{h.qtyBefore} → {h.qtyAfter}</span>
                <span className="shrink-0 text-ink-500">
                  {new Date(h.at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-6 border-t border-ink-700 pt-3">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-ink-400">Delete “{item.name}” permanently?</span>
            <button className="btn btn-ghost text-xs" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button
              className="btn btn-danger text-xs"
              onClick={async () => { await deleteItem(item.id); onClose() }}
            >Delete</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              className="btn btn-ghost text-xs"
              onClick={() => saveItem({ id: item.id, archived: !item.archived })}
            >
              {item.archived ? 'Un-archive' : 'Archive'}
            </button>
            <button className="btn btn-ghost text-xs text-ink-400" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="panel px-2.5 py-2">
      <dt className="text-[0.62rem] font-semibold uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-xs ${tone === 'warn' ? 'text-amber-300' : 'text-ink-200'}`}>{value}</dd>
    </div>
  )
}

function Photos({ item, onSave }: { item: Item; onSave: (p: Partial<Item> & { id: string }) => Promise<string> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const urls: string[] = []
      for (const f of Array.from(files)) urls.push(await uploadPhoto(f, 'items', item.name))
      await onSave({ id: item.id, photoUrls: [...(item.photoUrls ?? []), ...urls] })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (url: string) => {
    await onSave({ id: item.id, photoUrls: (item.photoUrls ?? []).filter(u => u !== url) })
    void deletePhoto(url)
  }

  return (
    <div className="mt-3">
      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {(item.photoUrls ?? []).map(url => (
          <div key={url} className="relative shrink-0">
            <img src={url} alt="" className="size-24 rounded-xl object-cover" />
            <button
              onClick={() => remove(url)}
              className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-[0.6rem] text-ink-200"
              aria-label="Remove photo"
            >×</button>
          </div>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-ink-600 text-xs text-ink-400 hover:border-brass-500/60 hover:text-brass-400"
        >
          {busy ? '…' : '📷 Add'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={e => add(e.target.files)}
      />
    </div>
  )
}

function EditForm({ item, onSave }: { item: Item; onSave: (p: Partial<Item>) => Promise<void> }) {
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)
  const saveLocation = useStore(s => s.saveLocation)
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  const [d, setD] = useState<Partial<Item>>({})
  const v = <K extends keyof Item>(k: K): Item[K] => (d[k] !== undefined ? d[k] as Item[K] : item[k])
  const set = <K extends keyof Item>(k: K, val: Item[K]) => setD(p => ({ ...p, [k]: val }))
  const dirty = Object.keys(d).length > 0

  const [newLoc, setNewLoc] = useState('')

  const addLocation = async () => {
    if (!newLoc.trim()) return
    const id = await saveLocation({ name: newLoc.trim(), kind: 'cabinet' })
    set('locationId', id)
    setNewLoc('')
  }

  return (
    <div className="mt-4 space-y-3 border-t border-ink-700 pt-4">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name"><input type="text" value={v('name') ?? ''} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Brand"><input type="text" value={v('brand') ?? ''} onChange={e => set('brand', e.target.value)} /></Field>
      </div>

      <Field label="Where it lives">
        <select value={v('locationId') ?? ''} onChange={e => set('locationId', e.target.value || null)}>
          <option value="">Unfiled</option>
          {locations
            .slice()
            .sort((a, b) => locationPath(a.id, locMap, plan).localeCompare(locationPath(b.id, locMap, plan)))
            .map(l => (
              <option key={l.id} value={l.id}>{locationPath(l.id, locMap, plan)}</option>
            ))}
        </select>
      </Field>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="…or type a new place"
          value={newLoc}
          onChange={e => setNewLoc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addLocation() } }}
        />
        <button className="btn btn-ghost shrink-0 text-xs" onClick={addLocation} disabled={!newLoc.trim()}>Add place</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Unit">
          <select value={v('unit') ?? 'pcs'} onChange={e => set('unit', e.target.value as Unit)}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Min" hint="low at">
          <input type="number" inputMode="decimal" value={v('minQty') ?? 0} onChange={e => set('minQty', Number(e.target.value))} />
        </Field>
        <Field label="Par" hint="buy up to">
          <input type="number" inputMode="decimal" value={v('parLevel') ?? 0} onChange={e => set('parLevel', Number(e.target.value))} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Category">
          <select value={v('category') ?? 'Other'} onChange={e => set('category', e.target.value)}>
            {DEFAULT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Expiry" hint="optional">
          <input
            type="date"
            value={(v('expiryDate') ?? '')?.slice(0, 10) ?? ''}
            onChange={e => set('expiryDate', e.target.value || null)}
          />
        </Field>
      </div>

      <Field label="Tags" hint="comma separated">
        <input
          type="text"
          value={(v('tags') ?? []).join(', ')}
          onChange={e => set('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
        />
      </Field>

      <Field label="Notes"><textarea rows={2} value={v('notes') ?? ''} onChange={e => set('notes', e.target.value)} /></Field>

      <Field label="Telegram alerts" hint="when to ping the group">
        <select
          value={v('notify') ?? 'default'}
          onChange={e => set('notify', e.target.value as Item['notify'])}
        >
          <option value="default">Normal — appears in the weekly list</option>
          <option value="urgent">Urgent — ping the day it runs low</option>
          <option value="never">Never mention this one</option>
        </select>
      </Field>

      <div className="flex flex-wrap gap-3 text-xs">
        <Toggle label="Perishable" checked={!!v('perishable')} onChange={b => set('perishable', b)} />
        <Toggle
          label="Seasonal (never nag)"
          checked={!!v('seasonal')}
          onChange={b => set('seasonal', b)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Buy from" hint="override">
          <select value={v('storeHint') ?? ''} onChange={e => set('storeHint', (e.target.value || null) as StoreKey | null)}>
            <option value="">Auto (cheapest known)</option>
            {STORES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Shopee link" hint="paste once">
          <input type="url" placeholder="https://shopee.sg/…" value={v('shopeeUrl') ?? ''} onChange={e => set('shopeeUrl', e.target.value || null)} />
        </Field>
      </div>

      <PriceEditor
        refs={(v('priceRefs') ?? []) as PriceRef[]}
        myrPerSgd={settings.myrPerSgd}
        onChange={r => set('priceRefs', r)}
      />

      <button
        className="btn btn-primary w-full"
        disabled={!dirty}
        onClick={async () => { await onSave(d); setD({}) }}
      >
        {dirty ? 'Save changes' : 'No changes'}
      </button>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-ink-300">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="size-4 accent-[#E8A33D]" />
      {label}
    </label>
  )
}

function PriceEditor({ refs, myrPerSgd, onChange }: {
  refs: PriceRef[]; myrPerSgd: number; onChange: (r: PriceRef[]) => void
}) {
  const [store, setStore] = useState<StoreKey>('ntuc')
  const [price, setPrice] = useState('')

  const currency: Currency = STORES.find(s => s.key === store)?.currency ?? 'SGD'

  const add = () => {
    const p = Number(price)
    if (!Number.isFinite(p) || p <= 0) return
    const next = refs.filter(r => r.store !== store)
    next.push({ store, price: p, currency, checkedAt: new Date().toISOString() })
    onChange(next)
    setPrice('')
  }

  return (
    <div>
      <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">
        Prices you have seen
      </div>
      {refs.length > 0 && (
        <ul className="mb-2 space-y-1 text-xs">
          {refs.map(r => (
            <li key={r.store} className="flex items-center gap-2 rounded-lg bg-ink-850 px-2 py-1.5">
              <span className="flex-1 text-ink-300">{storeShort(r.store)}</span>
              <span className="tnum text-ink-200">
                {r.currency === 'MYR' ? 'RM' : 'S$'}{r.price.toFixed(2)}
              </span>
              {r.currency === 'MYR' && (
                <span className="tnum text-[0.65rem] text-ink-500">
                  ≈S${(r.price / (myrPerSgd || 3.35)).toFixed(2)}
                </span>
              )}
              <button className="text-ink-500 hover:text-rose-300" onClick={() => onChange(refs.filter(x => x.store !== r.store))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <select className="flex-1" value={store} onChange={e => setStore(e.target.value as StoreKey)}>
          {STORES.map(s => <option key={s.key} value={s.key}>{s.short} ({s.currency})</option>)}
        </select>
        <input
          type="number"
          inputMode="decimal"
          className="w-24"
          placeholder={currency === 'MYR' ? 'RM' : 'S$'}
          value={price}
          onChange={e => setPrice(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button className="btn btn-ghost shrink-0 text-xs" onClick={add}>Add</button>
      </div>
      <p className="mt-1 text-[0.65rem] leading-relaxed text-ink-500">
        No retailer here publishes a usable price API, so prices are whatever you record.
        Two or more and the shopping list routes you to the cheaper one automatically.
      </p>
    </div>
  )
}

function TelegramActions({ item }: { item: Item }) {
  const [queued, setQueued] = useState(false)
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  const text = [
    item.brand ? `${item.brand} ${item.name}` : item.name,
    `${locationPath(item.locationId, locMap, plan)}`,
    `Have ${item.qty} ${item.unit} (min ${item.minQty}, par ${item.parLevel})`,
  ].join('\n')

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {/* Instant, and needs no bot: opens Telegram with the text ready. */}
      <a
        className="btn btn-ghost text-xs"
        href={`https://t.me/share/url?url=&text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noreferrer noopener"
      >Share now ↗</a>
      <button
        className="btn btn-ghost text-xs"
        disabled={queued}
        onClick={async () => {
          await setDoc(doc(db, 'telegram', 'outbox'), {
            status: 'pending', kind: 'item', itemId: item.id,
            requestedAt: new Date().toISOString(),
            requestedBy: useStore.getState().user?.email ?? 'app',
          })
          setQueued(true)
        }}
      >{queued ? 'Bot will send it ✓' : 'Send via bot'}</button>
    </div>
  )
}
