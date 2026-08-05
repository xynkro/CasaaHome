import type { Item, Settings, TripKey } from '../types'
import { shopeeSearch, storeShort } from './links'
import type { ShoppingPlan, SalePhase, UseSoonEntry } from './shopping'
import { shouldWaitForSale } from './shopping'

/**
 * Telegram digest formatting.
 *
 * Pure: no Firebase, no network. The notifier sends what this returns, and
 * `scripts/preview.ts` renders the same text from sample data, so the wording
 * can be checked without touching the real inventory.
 */

export const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const TRIP: Record<TripKey, { head: string; note: string }> = {
  sg: { head: '🛒 <b>In store — Singapore</b>', note: 'FairPrice / nearby' },
  jb: { head: '🚗 <b>In store — JB</b>', note: 'Giant · AEON, bring the boot' },
  online: { head: '📦 <b>Online — Shopee</b>', note: '' },
}

/**
 * "Shopee $4.20 vs NTUC $5.90 → saves ~$1.70 each".
 *
 * The prices quoted are per unit, so the saving is quoted per unit too —
 * mixing a unit price with a basket-total saving reads as a mistake. The
 * line's own total already accounts for quantity.
 */
export function compareLine(l: ShoppingPlan['lines'][number]): string | null {
  const alts = l.alternatives ?? []
  if (alts.length < 2) return null
  const bits = alts.slice(0, 3).map(a => `${storeShort(a.store)} $${a.sgd.toFixed(2)}`)
  const perUnit = alts[alts.length - 1].sgd - alts[0].sgd
  const saving = perUnit > 0.05 ? ` → saves ~$${perUnit.toFixed(2)} each` : ''
  return `${bits.join(' vs ')}${saving}`
}

export function tripMessage(
  trip: TripKey,
  plan: ShoppingPlan,
  items: Item[],
  sale: SalePhase,
  settings: Settings,
) {
  const lines = plan.byTrip[trip]
  if (!lines.length) return null

  const out = [TRIP[trip].head]
  if (TRIP[trip].note) out.push(`<i>${TRIP[trip].note}</i>`)

  if (trip === 'online') {
    out.push(sale.live
      ? `🔥 <i>${sale.label} sale is on today — order now.</i>`
      : `<i>Next Shopee sale: ${sale.label}, in ${sale.daysUntilStart} ${sale.daysUntilStart === 1 ? 'day' : 'days'}.</i>`)
  }
  out.push('')

  const now: string[] = []
  const later: string[] = []
  for (const l of lines) {
    const item = items.find(i => i.id === l.itemId)
    const price = l.estSgd ? ` — ~S$${l.estSgd.toFixed(2)}` : ''
    const flag = l.reason === 'out' ? ' ⚠️' : ''
    const name = esc(l.name)
    const label = trip === 'online' && item
      ? `<a href="${esc(shopeeSearch(item))}">${name}</a>`
      : name
    const row = [`• ${label} × ${l.qty} ${esc(l.unit)}${price}${flag}`]
    const cmp = compareLine(l)
    if (cmp) row.push(`   <i>${esc(cmp)}</i>`)
    ;(shouldWaitForSale(l, sale, settings.saleWaitDays) ? later : now).push(...row)
  }

  out.push(...now)
  if (later.length) {
    out.push('', `⏳ <b>Can wait for ${sale.label}</b> <i>(${sale.daysUntilStart}d away)</i>`, ...later)
  }
  const total = plan.totals[trip]
  if (total > 0) out.push('', `<b>~S$${total.toFixed(2)}</b>`)
  return out.join('\n')
}

export function useSoonMessage(entries: UseSoonEntry[]) {
  if (!entries.length) return null
  const expiring = entries.filter(e => e.reason !== 'forgotten')
  const forgotten = entries.filter(e => e.reason === 'forgotten')
  const out: string[] = ['🍽 <b>Use these up</b>', '']

  if (expiring.length) {
    for (const e of expiring.slice(0, 20)) {
      const icon = e.reason === 'expired' ? '❌' : '⏳'
      out.push(`${icon} ${esc(e.item.name)} — ${esc(e.detail)}`)
      out.push(`   <i>${esc(e.locationName)}</i>`)
    }
  }

  if (forgotten.length) {
    out.push('', '📦 <b>Forgotten in storage</b>')
    out.push('<i>Sitting untouched. Seasonal things are excluded.</i>', '')
    for (const e of forgotten.slice(0, 15)) {
      out.push(`• ${esc(e.item.name)} — <i>${esc(e.locationName)}</i>`)
    }
  }
  return out.join('\n')
}

