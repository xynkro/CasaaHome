import { useMemo, useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useStore } from '../store'
import { buildShoppingPlan, buildUseSoon } from '../lib/shopping'
import { storeShort } from '../lib/links'
import type { ShoppingLine, TripKey } from '../types'
import { Empty } from '../ui/primitives'

const TRIP_META: Record<TripKey, { title: string; sub: string; icon: string }> = {
  sg: { title: 'Singapore run', sub: 'FairPrice / nearby', icon: '🛒' },
  jb: { title: 'JB run', sub: 'Giant · AEON', icon: '🚗' },
  online: { title: 'Order online', sub: 'Shopee', icon: '📦' },
}

export default function ShoppingView({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const settings = useStore(s => s.settings)
  const shopping = useStore(s => s.shopping)
  const saveShopping = useStore(s => s.saveShopping)
  const setQty = useStore(s => s.setQty)

  const [sent, setSent] = useState<'idle' | 'queued' | 'error'>('idle')

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])
  const live = useMemo(() => items.filter(i => !i.archived), [items])
  const plan = useMemo(
    () => buildShoppingPlan(live, settings, shopping.manual ?? []),
    [live, settings, shopping.manual],
  )
  const useSoon = useMemo(() => buildUseSoon(live, locMap, settings), [live, locMap, settings])

  const checked = shopping.checked ?? {}
  const toggle = (id: string) => saveShopping({ checked: { ...checked, [id]: !checked[id] } })
  const clearChecked = () => saveShopping({ checked: {} })

  const total = plan.totals.sg + plan.totals.jb + plan.totals.online
  const anyLines = plan.lines.length > 0

  const asText = () => {
    const out: string[] = [`${settings.householdName || 'Home'} shopping list`, '']
    for (const trip of ['sg', 'jb', 'online'] as TripKey[]) {
      const lines = plan.byTrip[trip]
      if (!lines.length) continue
      out.push(`${TRIP_META[trip].icon} ${TRIP_META[trip].title}`)
      for (const l of lines) out.push(`  • ${l.name} × ${l.qty} ${l.unit}${l.estSgd ? ` (~S$${l.estSgd.toFixed(2)})` : ''}`)
      out.push('')
    }
    if (total > 0) out.push(`Rough total: S$${total.toFixed(2)}`)
    return out.join('\n')
  }

  /**
   * The bot token lives in GitHub Actions secrets, never in this bundle, so
   * the app cannot send a message itself. It leaves a request the scheduled
   * job picks up on its next hourly pass.
   */
  const queueTelegram = async () => {
    try {
      await setDoc(doc(db, 'telegram', 'outbox'), {
        requestedAt: new Date().toISOString(),
        requestedBy: useStore.getState().user?.email ?? 'app',
        kind: 'shopping',
        status: 'pending',
      })
      setSent('queued')
    } catch {
      setSent('error')
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-ink-200">Shopping</h1>
        {Object.values(checked).some(Boolean) && (
          <button className="text-mini text-ink-400 hover:text-ink-200" onClick={clearChecked}>Clear ticks</button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-400">
        Built from what is out or low, split by where it is cheapest to buy.
      </p>

      {!anyLines ? (
        <div className="mt-5">
          <Empty icon="✓" title="Nothing to buy" hint="Everything is above its minimum. The list fills itself as stock drops." />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {!plan.jbWorthIt && plan.jbFolded.length > 0 && (
            <div className="rounded-xl border border-ink-600 bg-ink-850 px-3 py-2.5 text-mini leading-relaxed text-ink-400">
              <span className="font-semibold text-ink-300">JB run skipped.</span>{' '}
              {plan.jbFolded.length} cheaper-in-JB {plan.jbFolded.length === 1 ? 'item was' : 'items were'} folded into the
              Singapore list — the basket is under S${settings.jbMinBasketSgd}, so the causeway is not worth it yet.
            </div>
          )}

          {(['sg', 'jb', 'online'] as TripKey[]).map(trip => {
            const lines = plan.byTrip[trip]
            if (!lines.length) return null
            const meta = TRIP_META[trip]
            const remaining = lines.filter(l => !checked[l.itemId]).length
            return (
              <section key={trip} className="panel overflow-hidden">
                <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5">
                  <span className="text-base">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-200">{meta.title}</div>
                    <div className="text-micro text-ink-500">{meta.sub}</div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-sm font-semibold text-ink-200">
                      {plan.totals[trip] > 0 ? `~S$${plan.totals[trip].toFixed(0)}` : '—'}
                    </div>
                    <div className="tnum text-micro text-ink-500">{remaining} left</div>
                  </div>
                </header>
                <ul>
                  {lines.map(l => (
                    <Line
                      key={l.itemId}
                      line={l}
                      checked={!!checked[l.itemId]}
                      onToggle={() => toggle(l.itemId)}
                      onOpen={() => onOpenItem(l.itemId)}
                      onBought={async () => {
                        const item = live.find(i => i.id === l.itemId)
                        if (!item) return
                        await setQty(l.itemId, item.qty + l.qty, 'restock')
                        await saveShopping({ checked: { ...checked, [l.itemId]: true } })
                      }}
                    />
                  ))}
                </ul>
              </section>
            )
          })}

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost text-xs" onClick={() => navigator.clipboard?.writeText(asText())}>
              Copy list
            </button>
            <a
              className="btn btn-ghost text-xs"
              href={`https://t.me/share/url?url=&text=${encodeURIComponent(asText())}`}
              target="_blank"
              rel="noreferrer noopener"
            >Share to Telegram now ↗</a>
            <button className="btn btn-ghost text-xs" onClick={queueTelegram} disabled={sent === 'queued'}>
              {sent === 'queued' ? 'Queued ✓' : sent === 'error' ? 'Failed — retry' : 'Ask the bot to send it'}
            </button>
          </div>
          {sent === 'queued' && (
            <p className="text-mini text-ink-500">
              The scheduled job picks this up on its next hourly pass and sends it from the bot.
            </p>
          )}
        </div>
      )}

      {useSoon.length > 0 && (
        <section className="panel mt-5 overflow-hidden">
          <header className="border-b border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
            Use these before buying more
          </header>
          <ul className="divide-y divide-ink-700/60">
            {useSoon.slice(0, 15).map(e => (
              <li key={e.item.id}>
                <button onClick={() => onOpenItem(e.item.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-800/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-200">{e.item.name}</span>
                    <span className="block truncate text-mini text-ink-500">{e.locationName}</span>
                  </span>
                  <span className={`shrink-0 text-mini ${e.reason === 'expired' ? 'text-rose-300' : e.reason === 'expiring' ? 'text-amber-300' : 'text-ink-400'}`}>
                    {e.detail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Line({ line, checked, onToggle, onOpen, onBought }: {
  line: ShoppingLine
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onBought: () => void
}) {
  return (
    <li className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-2.5 last:border-0">
      <button
        onClick={onToggle}
        className={`grid size-5 shrink-0 place-items-center rounded-md border text-micro transition ${
          checked ? 'border-brass-500 bg-brass-400 text-ink-900' : 'border-ink-500 text-transparent hover:border-ink-400'
        }`}
        aria-label={checked ? 'Untick' : 'Tick'}
      >✓</button>

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={`block text-sm leading-tight ${checked ? 'text-ink-500 line-through' : 'text-ink-200'}`}>
          {line.name}
        </span>
        <span className="flex items-center gap-1.5 text-micro text-ink-500">
          <span className="tnum">× {line.qty} {line.unit}</span>
          <span>·</span>
          <span>{storeShort(line.store)}</span>
          {line.reason === 'out' && <span className="text-rose-300">out</span>}
          {line.savingNote && <span className="text-emerald-400">{line.savingNote}</span>}
        </span>
      </button>

      {line.estSgd !== null && (
        <span className="tnum shrink-0 text-xs text-ink-400">S${line.estSgd.toFixed(2)}</span>
      )}

      {line.url && (
        <a
          href={line.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 px-1 text-ink-500 hover:text-brass-400"
          aria-label="Open in store"
          onClick={e => e.stopPropagation()}
        >↗</a>
      )}

      {/* Icon-only: on a 375px screen a "+stock" label steals the width the
          item name needs, and every name ends up truncated. */}
      <button
        onClick={onBought}
        className="grid size-6 shrink-0 place-items-center rounded-md border border-ink-600 text-sm leading-none text-ink-400 hover:border-emerald-500/50 hover:text-emerald-300"
        title="Bought it — add to stock"
        aria-label="Bought it, add to stock"
      >+</button>
    </li>
  )
}
