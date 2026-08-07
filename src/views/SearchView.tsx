import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { useStore, locationPath } from '../store'
import type { StockStatus, StorageLocation } from '../types'
import { STATUS_ORDER, stockStatus } from '../lib/stock'
import { Empty } from '../ui/primitives'
import { ItemRow } from '../ui/ItemRow'
import AddItem from './AddItem'
import PlaceSheet from './PlaceSheet'
import { parseTags, tagCloud, tagQuery } from '../lib/tags'

type Filter = 'all' | 'attention' | 'places' | 'perishable' | 'seasonal' | 'unfiled'

/**
 * Search covers cupboards as well as things.
 *
 * Most of a home is never itemised — you photograph a cupboard, type a few
 * words about what is in it, and move on. Searching only the item list made
 * every one of those cupboards invisible, which is the opposite of the point.
 * A place matches on its name, its room, its kind and its contents note, and
 * comes back with the photo attached.
 */
type Hit =
  | { kind: 'item'; id: string; title: string; where: string; blob: string; tags: string[] }
  | { kind: 'place'; id: string; title: string; where: string; blob: string; tags: string[] }

export default function SearchView({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [category, setCategory] = useState('')
  const [adding, setAdding] = useState(false)
  const [openPlace, setOpenPlace] = useState<string | null>(null)
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
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  const indexed = useMemo<Hit[]>(() => {
    const out: Hit[] = []
    for (const i of items) {
      if (i.archived) continue
      const where = locationPath(i.locationId, locMap, plan)
      const tags = [...(i.tags ?? []).map(t => t.toLowerCase()), ...parseTags(i.notes)]
      out.push({
        kind: 'item', id: i.id, title: i.name, where, tags,
        blob: [i.name, i.brand, where, i.category, tags.join(' '), i.notes].filter(Boolean).join(' '),
      })
    }
    for (const l of locations) {
      const where = locationPath(l.id, locMap, plan)
      const tags = parseTags(l.contents)
      out.push({
        kind: 'place', id: l.id, title: l.name, where, tags,
        blob: [l.name, where, l.kind, l.contents, l.notes].filter(Boolean).join(' '),
      })
    }
    return out
  }, [items, locations, locMap, plan])

  const fuse = useMemo(
    () => new Fuse(indexed, {
      keys: [
        { name: 'title', weight: 3 },
        // A tag was typed on purpose, so it should beat an incidental word.
        { name: 'tags', weight: 2.5 },
        { name: 'where', weight: 1.5 },
        { name: 'blob', weight: 1 },
      ],
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 2,
    }),
    [indexed],
  )

  const results = useMemo(() => {
    const q = deferred.trim()
    // "#wine" means only things tagged wine — an exact filter, not a fuzzy
    // match that also drags in every mention of the word.
    const exact = tagQuery(q)
    let base = exact
      ? indexed.filter(h => h.tags.includes(exact))
      : q.length >= 2 ? fuse.search(q).map(r => r.item) : indexed

    const item = (h: Hit) => (h.kind === 'item' ? itemById.get(h.id) : undefined)
    const place = (h: Hit) => (h.kind === 'place' ? locMap.get(h.id) : undefined)

    if (category) base = base.filter(h => item(h)?.category === category)

    switch (filter) {
      case 'places':     base = base.filter(h => h.kind === 'place'); break
      case 'attention':  base = base.filter(h => { const i = item(h); return i && stockStatus(i, settings) !== 'ok' }); break
      case 'perishable': base = base.filter(h => item(h)?.perishable); break
      case 'seasonal':   base = base.filter(h => item(h)?.seasonal); break
      case 'unfiled':    base = base.filter(h => h.kind === 'item' && !item(h)?.locationId); break
    }

    // With no query, lead with what needs attention, then places, then the rest.
    if (q.length < 2) {
      const rank = (h: Hit) => {
        const i = item(h)
        if (i) return STATUS_ORDER[stockStatus(i, settings) as StockStatus]
        return place(h)?.shots?.open ? 4.5 : 5
      }
      base = [...base].sort((a, b) => {
        const ra = rank(a), rb = rank(b)
        return ra === rb ? a.title.localeCompare(b.title) : ra - rb
      })
    }
    return base
  }, [deferred, fuse, indexed, filter, category, settings, itemById, locMap])

  const allTags = useMemo(
    () => tagCloud([...locations.map(l => l.contents), ...items.map(i => i.notes)]).slice(0, 24),
    [locations, items],
  )

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
            ['all', 'All'], ['attention', 'Needs attention'], ['places', 'Cupboards'],
            ['perishable', 'Perishable'], ['seasonal', 'Seasonal'], ['unfiled', 'Unfiled'],
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

      {allTags.length > 0 && (
        <div className="scroll-thin -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {allTags.map(t => (
            <button
              key={t.tag}
              onClick={() => setQ(q === `#${t.tag}` ? '' : `#${t.tag}`)}
              className={`chip shrink-0 ${
                q === `#${t.tag}`
                  ? 'border-brass-500/50 bg-brass-400/12 text-brass-300'
                  : 'border-ink-600 bg-ink-800 text-ink-400'
              }`}
            >#{t.tag} <span className="tnum opacity-60">{t.count}</span></button>
          ))}
        </div>
      )}

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
        <div className="mt-2 space-y-2">
          {/* Item hits share one tile; each cupboard is its own plate. */}
          <div className="panel overflow-hidden">
          {results.slice(0, 200).filter(h => h.kind === 'item').map(h => (
            <ItemRow
              key={`i${h.id}`}
              item={itemById.get(h.id)!}
              settings={settings}
              locMap={locMap}
              plan={plan}
              onOpen={onOpenItem}
            />
          ))}
          </div>

          {results.slice(0, 200).filter(h => h.kind === 'place').map(h => (
            <PlaceResult key={`p${h.id}`} loc={locMap.get(h.id)!} where={h.where} onOpen={setOpenPlace} />
          ))}

          {results.length > 200 && (
            <div className="panel px-3 py-2 text-center text-mini text-ink-400">
              Showing first 200 — narrow the search
            </div>
          )}
        </div>
      )}

      <AddItem open={adding} onClose={() => setAdding(false)} onOpenItem={onOpenItem} />
      <PlaceSheet locationId={openPlace} onClose={() => setOpenPlace(null)} onOpenItem={onOpenItem} />
    </div>
  )
}

/**
 * The open-cupboard plate.
 *
 * "Where are the wine glasses?" is the question this app exists to answer, and
 * the answer is a photograph of the inside of a cupboard. So the photograph is
 * the result — full width, uncropped by a thumbnail, with nothing laid over
 * it. The caption sits in an opaque foot BELOW the image rather than in a
 * gradient scrim on top: the text measures 13.7:1 that way and the photo keeps
 * its full strength, where a scrim would compromise both.
 */
function PlaceResult({ loc, where, onOpen }: {
  loc: StorageLocation; where: string; onOpen: (id: string) => void
}) {
  const shot = loc.shots?.open ?? loc.shots?.closed ?? loc.photoUrls?.[0]
  const tags = parseTags(loc.contents)
  return (
    <button
      onClick={() => onOpen(loc.id)}
      className="block w-full overflow-hidden rounded-[14px] border border-ink-700 bg-ink-800 text-left"
    >
      {shot ? (
        <img src={shot} alt="" loading="lazy" className="aspect-[3/2] w-full object-cover" />
      ) : (
        // A deliberate blank, not a broken image.
        <div className="grid aspect-[3/2] w-full place-items-center bg-ink-900 text-3xl font-semibold text-ink-500">
          {loc.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="px-3 py-2.5">
        <div className="truncate text-[17px] font-medium text-ink-200">{loc.name}</div>
        <div className="mt-0.5 truncate text-mini text-ink-400">
          {tags.length ? tags.map(t => `#${t}`).join('  ') : (loc.contents || where)}
        </div>
      </div>
    </button>
  )
}
