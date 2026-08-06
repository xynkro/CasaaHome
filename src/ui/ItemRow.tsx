import type { Item, Settings, StorageLocation, HousePlan } from '../types'
import { fmtCover, fmtQty, stockStatus } from '../lib/stock'
import { StatusChip } from './primitives'
import { locationPath } from '../store'

export function ItemRow({
  item, settings, locMap, plan, onOpen, right, dense,
}: {
  item: Item
  settings: Settings
  locMap: Map<string, StorageLocation>
  plan: HousePlan
  onOpen: (id: string) => void
  right?: React.ReactNode
  dense?: boolean
}) {
  const status = stockStatus(item, settings)
  const cover = fmtCover(item)
  const where = locationPath(item.locationId, locMap, plan)
  const thumb = item.photoUrls?.[0]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={e => {
        // Space scrolls the page by default, so a role=button has to claim it.
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item.id) }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 border-b border-ink-700/60 px-3 py-2.5 text-left transition last:border-0 hover:bg-ink-800/60"
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className={`shrink-0 rounded-lg object-cover ${dense ? 'size-9' : 'size-11'}`}
        />
      ) : (
        <div className={`grid shrink-0 place-items-center rounded-lg bg-ink-700/60 text-ink-500 ${dense ? 'size-9 text-sm' : 'size-11'}`}>
          {item.name.slice(0, 1).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink-200">
            {item.brand ? <span className="text-ink-400">{item.brand} </span> : null}
            {item.name}
          </span>
          {status !== 'ok' && <StatusChip status={status} small />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-mini text-ink-400">
          <span className="truncate">{where}</span>
          {cover && <><span className="text-ink-600">·</span><span className="shrink-0">{cover}</span></>}
        </div>
      </div>

      {right ?? (
        <div className="tnum shrink-0 text-right">
          <div className="text-sm font-semibold text-ink-200">{fmtQty(item.qty, item.unit)}</div>
          {item.parLevel > 0 && (
            <div className="text-micro text-ink-500">par {item.parLevel}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function SectionCard({
  title, count, tone, children, action,
}: {
  title: string
  count?: number
  tone?: 'bad' | 'warn' | 'default'
  children: React.ReactNode
  action?: React.ReactNode
}) {
  const dot = tone === 'bad' ? 'bg-rose-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-ink-500'
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-ink-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${dot}`} />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-300">{title}</h2>
          {count !== undefined && (
            <span className="tnum rounded-full bg-ink-700 px-1.5 text-micro font-semibold text-ink-300">{count}</span>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
