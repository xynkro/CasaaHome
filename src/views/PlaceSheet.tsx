import { useMemo, useState } from 'react'
import { useStore, locationPath } from '../store'
import { stockStatus } from '../lib/stock'
import { Sheet } from '../ui/primitives'
import { parseTags, stripTags } from '../lib/tags'
import { ItemRow } from '../ui/ItemRow'
import AddItem from './AddItem'

/**
 * A cupboard, opened.
 *
 * For places that were photographed rather than itemised, this is the whole
 * record: the open shot is the inventory, and it is shown large because
 * looking at it is the point. Items, where any exist, sit underneath.
 */
export default function PlaceSheet({
  locationId, onClose, onOpenItem,
}: {
  locationId: string | null
  onClose: () => void
  onOpenItem: (id: string) => void
}) {
  const locations = useStore(s => s.locations)
  const items = useStore(s => s.items)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)
  const [addOpen, setAddOpen] = useState(false)

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])
  const loc = locationId ? locMap.get(locationId) : null

  const inside = useMemo(
    () => items
      .filter(i => !i.archived && i.locationId === locationId)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [items, locationId],
  )

  if (!loc) return null

  const shots = [loc.shots?.open, loc.shots?.closed, ...(loc.photoUrls ?? [])].filter(Boolean) as string[]
  const tags = parseTags(loc.contents)
  // Only show the sentence if there is one beyond the tags themselves.
  const prose = tags.length && stripTags(loc.contents) === tags.join(' ') ? '' : loc.contents
  const lowCount = inside.filter(i => stockStatus(i, settings) !== 'ok').length

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        wide
        title={loc.name}
        footer={
          <button className="btn btn-primary w-full" onClick={() => setAddOpen(true)}>
            + Add something to {loc.name}
          </button>
        }
      >
        <div className="text-mini text-ink-400">{locationPath(loc.id, locMap, plan)}</div>

        {shots.length > 0 ? (
          <div className="scroll-thin -mx-1 mt-3 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
            {shots.map(url => (
              <img
                key={url}
                src={url}
                alt=""
                className="h-56 snap-start rounded-xl object-cover"
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-ink-600 px-3 py-4 text-center text-xs text-ink-400">
            No photo yet. The photo sweep on the Places tab walks you through it.
          </p>
        )}

        {loc.contents && (
          <div className="mt-3 rounded-lg bg-ink-850 px-3 py-2.5">
            <div className="text-micro font-semibold uppercase tracking-wider text-ink-500">
              What is in here
            </div>
            {tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tags.map(t => (
                  <span key={t} className="chip border-brass-500/40 bg-brass-400/12 text-brass-300">#{t}</span>
                ))}
              </div>
            )}
            {prose && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-300">{prose}</p>}
          </div>
        )}

        {loc.notes && <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-ink-400">{loc.notes}</p>}

        {inside.length > 0 && (
          <div className="panel mt-4 overflow-hidden">
            <header className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
              <span className="text-micro font-semibold uppercase tracking-wider text-ink-300">
                Tracked here
              </span>
              <span className="tnum text-micro text-ink-500">
                {inside.length}{lowCount > 0 ? ` · ${lowCount} need attention` : ''}
              </span>
            </header>
            {inside.map(i => (
              <ItemRow
                key={i.id}
                item={i}
                settings={settings}
                locMap={locMap}
                plan={plan}
                onOpen={id => { onClose(); onOpenItem(id) }}
                dense
              />
            ))}
          </div>
        )}
      </Sheet>

      <AddItem
        open={addOpen}
        presetLocationId={loc.id}
        onClose={() => setAddOpen(false)}
        onOpenItem={onOpenItem}
      />
    </>
  )
}
