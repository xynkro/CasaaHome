import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { stockStatus, isStale, daysBetween } from '../lib/stock'
import { buildUseSoon } from '../lib/shopping'
import { Empty, Stat } from '../ui/primitives'
import { ItemRow, SectionCard } from '../ui/ItemRow'
import VerifySweep from './VerifySweep'
import SnapPlace from './SnapPlace'
import RoomBoard from './RoomBoard'
import type { StockStatus } from '../types'

export default function Dashboard({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const settings = useStore(s => s.settings)
  const events = useStore(s => s.events)
  const loaded = useStore(s => s.loaded)
  const user = useStore(s => s.user)
  const [sweepOpen, setSweepOpen] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [openRoom, setOpenRoom] = useState<string | null>(null)

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])
  const live = useMemo(() => items.filter(i => !i.archived), [items])

  const byStatus = useMemo(() => {
    const m: Record<StockStatus, typeof live> = { out: [], expired: [], expiring: [], low: [], ok: [] }
    for (const i of live) m[stockStatus(i, settings)].push(i)
    return m
  }, [live, settings])

  const attention = useMemo(
    () => [...byStatus.out, ...byStatus.expired, ...byStatus.expiring, ...byStatus.low]
      .sort((a, b) => a.name.localeCompare(b.name)),
    [byStatus],
  )

  const useSoon = useMemo(
    () => buildUseSoon(live, locMap, settings).filter(e => e.reason === 'forgotten'),
    [live, locMap, settings],
  )

  const stale = useMemo(() => live.filter(i => isStale(i, settings)), [live, settings])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 5) return 'Late night'
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])

  // Prefer the nickname the household set over whatever Google has on file.
  const who = (settings.nicknames?.[user?.email ?? ''] ?? user?.displayName?.split(' ')[0] ?? '').slice(0, 18)

  if (loaded && live.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Header greeting={greeting} name={who} house={settings.householdName} />
        <div className="mt-6">
          <Empty
            icon="📷"
            title="Start with one cupboard"
            hint="Open it, hit Snap, and the camera comes up. Name it and tag what is inside while you are looking at the photo — that one cupboard is already searchable."
            action={<button className="btn btn-primary" onClick={() => setSnapping(true)}>Snap a cupboard</button>}
          />
        </div>
        <SnapPlace open={snapping} onClose={() => setSnapping(false)} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Header greeting={greeting} name={who} house={settings.householdName} />

      <div className="panel mt-4 flex overflow-hidden">
        <Stat value={byStatus.out.length + byStatus.expired.length} label="Out" tone={byStatus.out.length ? 'bad' : 'default'} />
        <Stat value={byStatus.low.length} label="Low" tone={byStatus.low.length ? 'warn' : 'default'} />
        <Stat value={byStatus.expiring.length} label="Expiring" tone={byStatus.expiring.length ? 'warn' : 'default'} />
        <Stat value={live.length} label="Items" />
      </div>

      <div className="mt-4 space-y-4">
        {stale.length > 0 && (
          <button
            onClick={() => setSweepOpen(true)}
            className="panel flex w-full items-center gap-3 px-3 py-3 text-left transition hover:border-brass-500/50"
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brass-400/12 text-brass-400">✓</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink-200">Run a verify sweep</div>
              <div className="truncate text-mini text-ink-400">
                {stale.length} {stale.length === 1 ? 'count has' : 'counts have'} not been eyeballed in {settings.staleVerifyDays}+ days
              </div>
            </div>
            <span className="text-ink-500">→</span>
          </button>
        )}

        {attention.length > 0 ? (
          <SectionCard
            title="Needs attention"
            count={attention.length}
            tone={byStatus.out.length ? 'bad' : 'warn'}
            action={<Link to="/shop" className="text-mini font-semibold text-brass-400 hover:text-brass-300">Shopping list →</Link>}
          >
            <div>
              {attention.slice(0, 12).map(i => (
                <ItemRow key={i.id} item={i} settings={settings} locMap={locMap} plan={plan} onOpen={onOpenItem} />
              ))}
            </div>
            {attention.length > 12 && (
              <div className="border-t border-ink-700 px-3 py-2 text-center text-mini text-ink-400">
                +{attention.length - 12} more
              </div>
            )}
          </SectionCard>
        ) : (
          <SectionCard title="Needs attention" count={0}>
            <div className="px-3 py-6 text-center text-xs text-ink-400">
              Everything is stocked. Nothing expiring.
            </div>
          </SectionCard>
        )}

        {useSoon.length > 0 && (
          <SectionCard title="Use these up" count={useSoon.length} tone="warn">
            <div>
              {useSoon.slice(0, 8).map(e => (
                <ItemRow
                  key={e.item.id}
                  item={e.item}
                  settings={settings}
                  locMap={locMap}
                  plan={plan}
                  onOpen={onOpenItem}
                  right={<span className="shrink-0 text-mini text-ink-400">{e.detail}</span>}
                />
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard
          title="Your rooms"
          count={plan.rooms.length}
          action={
            <button className="text-mini font-semibold text-brass-400 hover:text-brass-300" onClick={() => setSnapping(true)}>
              Snap a cupboard →
            </button>
          }
        >
          {plan.rooms.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs leading-relaxed text-ink-400">
              No rooms yet. Add them on the Places tab.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-px bg-ink-700/60 sm:grid-cols-3">
              {plan.rooms.map(r => {
                const n = locations.filter(l => l.roomId === r.id).length
                return (
                  <button
                    key={r.id}
                    onClick={() => setOpenRoom(r.id)}
                    className="group bg-ink-800 text-left transition hover:bg-ink-850"
                  >
                    {r.photoUrl ? (
                      <img src={r.photoUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    ) : (
                      // Not an error state — most rooms simply have not been
                      // photographed yet, and the invitation belongs here.
                      <div className="grid aspect-[4/3] w-full place-items-center bg-ink-850 text-lg text-ink-500">
                        <span className="opacity-70">📷</span>
                      </div>
                    )}
                    <div className="px-2.5 py-2">
                      <div className="truncate text-mini font-medium text-ink-200">{r.name}</div>
                      <div className="truncate text-micro text-ink-500">
                        {n ? `${n} ${n === 1 ? 'cupboard' : 'cupboards'}` : 'nothing yet'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </SectionCard>

        {events.length > 0 && (
          <SectionCard title="Recent activity">
            <ul className="divide-y divide-ink-700/60">
              {events.slice(0, 8).map(ev => {
                const item = items.find(i => i.id === ev.itemId)
                if (!item) return null
                const up = ev.delta > 0
                return (
                  <li key={ev.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className={`tnum w-12 shrink-0 text-right font-semibold ${up ? 'text-emerald-300' : 'text-ink-300'}`}>
                      {up ? '+' : ''}{ev.delta}
                    </span>
                    <button onClick={() => onOpenItem(item.id)} className="min-w-0 flex-1 truncate text-left text-ink-300 hover:text-ink-200">
                      {item.name}
                    </button>
                    <span className="shrink-0 text-ink-500">{relTime(ev.at)}</span>
                  </li>
                )
              })}
            </ul>
          </SectionCard>
        )}

        <div className="flex justify-center pt-2">
          <Link to="/settings" className="text-mini text-ink-500 hover:text-ink-300">Settings & Telegram</Link>
        </div>
      </div>

      <VerifySweep open={sweepOpen} onClose={() => setSweepOpen(false)} candidates={stale} />
      <SnapPlace open={snapping} onClose={() => setSnapping(false)} />
      <RoomBoard roomId={openRoom} onClose={() => setOpenRoom(null)} onOpenItem={onOpenItem} />
    </div>
  )
}

function Header({ greeting, name, house }: { greeting: string; name: string; house: string }) {
  return (
    <header className="rise">
      {/* The uppercase letterspaced eyebrow was the single most terminal-looking
          object on the dashboard. Sentence case, same accent. */}
      <div className="text-mini font-medium text-brass-400">{house || 'Home'}</div>
      <h1 className="mt-0.5 text-[28px] font-semibold tracking-[-0.011em] text-ink-200">
        {greeting}{name ? `, ${name}` : ''}
      </h1>
    </header>
  )
}

function relTime(iso: string): string {
  const d = daysBetween(iso)
  if (d < 1 / 24) return 'just now'
  if (d < 1) return `${Math.round(d * 24)}h ago`
  if (d < 7) return `${Math.round(d)}d ago`
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}
