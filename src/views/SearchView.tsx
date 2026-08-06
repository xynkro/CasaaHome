import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { useStore, locationPath } from '../store'
import type { StockStatus } from '../types'
import { STATUS_ORDER, stockStatus } from '../lib/stock'
import { Empty } from '../ui/primitives'
import { ItemRow } from '../ui/ItemRow'
import AddItem from './AddItem'

type Filter = 'all' | 'attention' | 'perishable' | 'seasonal' | 'unfiled'

export default function SearchView({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [category, setCategory] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const deferred = useDeferredValue(q)

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  // Search is a tab, not a modal. Autofocusing here threw the keyboard up over
  // the results and the nav on every single visit, even though the usual case
  // is browsing the sorted list rather than typing.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  // Index includes the resolved location path, so "kitchen" finds everything
  // in the kitchen even though items only store a location id.
  const indexed = useMemo(
    () => items
      .filter(i => !i.archived)
      .map(i => ({ item: i, where: locationPath(i.locationId, locMap, plan) })),
    [items, locMap, plan],
  )

  const fuse = useMemo(
    () => new Fuse(indexed, {
      keys: [
        { name: 'item.name', weight: 3 },
        { name: 'item.brand', weight: 1.5 },
        { name: 'where', weight: 1.5 },
        { name: 'item.category', weight: 1 },
        { name: 'item.tags', weight: 1 },
        { name: 'item.notes', weight: 0.4 },
      ],
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 2,
    }),
    [indexed],
  )

  const results = useMemo(() => {
    let base = deferred.trim().length >= 2
      ? fuse.search(deferred.trim()).map(r => r.item)
      : indexed

    if (category) base = base.filter(r => r.item.category === category)

    switch (filter) {
      case 'attention':
        base = base.filter(r => stockStatus(r.item, settings) !== 'ok'); break
      case 'perishable':
        base = base.filter(r => r.item.perishable); break
      case 'seasonal':
        base = base.filter(r => r.item.seasonal); break
      case 'unfiled':
        base = base.filter(r => !r.item.locationId); break
    }

    if (deferred.trim().length < 2) {
      base = [...base].sort((a, b) => {
        const sa = STATUS_ORDER[stockStatus(a.item, settings) as StockStatus]
        const sb = STATUS_ORDER[stockStatus(b.item, settings) as StockStatus]
        return sa === sb ? a.item.name.localeCompare(b.item.name) : sa - sb
      })
    }
    return base
  }, [deferred, fuse, indexed, filter, category, settings])

  const categories = useMemo(() => {
    const set = new Set(items.map(i => i.category).filter(Boolean))
    return [...set].sort()
  }, [items])

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="sticky top-0 z-10 -mx-4 bg-ink-900/92 px-4 pb-3 pt-1 backdrop-blur-lg">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="search"
            placeholder="Where is the… / what do I have?"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button className="btn btn-primary shrink-0" onClick={() => setAdding(true)}>+</button>
        </div>

        <div className="scroll-thin mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {([
            ['all', 'All'], ['attention', 'Needs attention'], ['perishable', 'Perishable'],
            ['seasonal', 'Seasonal'], ['unfiled', 'Unfiled'],
          ] as [Filter, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`chip shrink-0 ${
                filter === k
                  ? 'border-brass-500/50 bg-brass-400/12 text-brass-300'
                  : 'border-ink-600 bg-ink-800 text-ink-400'
              }`}
            >{label}</button>
          ))}
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="!w-auto shrink-0 !px-2"
          >
            <option value="">Any category</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-1 text-mini text-ink-500">
        {results.length} {results.length === 1 ? 'item' : 'items'}
      </div>

      {results.length === 0 ? (
        <div className="mt-4">
          <Empty
            icon="⌕"
            title={q ? `Nothing matches “${q}”` : 'Nothing here yet'}
            hint={q ? 'Try the brand, the room, or a tag.' : undefined}
            action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add an item</button>}
          />
        </div>
      ) : (
        <div className="panel mt-2 overflow-hidden">
          {results.slice(0, 200).map(r => (
            <ItemRow
              key={r.item.id}
              item={r.item}
              settings={settings}
              locMap={locMap}
              plan={plan}
              onOpen={onOpenItem}
            />
          ))}
          {results.length > 200 && (
            <div className="border-t border-ink-700 px-3 py-2 text-center text-mini text-ink-400">
              Showing first 200 — narrow the search
            </div>
          )}
        </div>
      )}

      <AddItem open={adding} onClose={() => setAdding(false)} onOpenItem={onOpenItem} />
    </div>
  )
}
