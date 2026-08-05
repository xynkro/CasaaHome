import type {
  Item, Settings, ShoppingLine, StorageLocation, StockStatus, StoreKey, TripKey,
} from '../types'
import { cheapestRef, storeSearchUrl, storeTrip, toSgd } from './links'
import { daysUntil, needsUseNudge, restockQty, stockStatus } from './stock'

/** Category defaults for when we have no price data at all. */
const CATEGORY_STORE: Record<string, StoreKey> = {
  'Fridge': 'ntuc',
  'Freezer': 'ntuc',
  'Pantry': 'ntuc',
  'Drinks': 'ntuc',
  'Snacks': 'ntuc',
  'Cleaning': 'giant_jb',
  'Laundry': 'giant_jb',
  'Paper goods': 'giant_jb',
  'Toiletries': 'giant_jb',
  'Pet': 'shopee',
  'Baby': 'shopee',
  'Tools': 'shopee',
  'Electrical': 'shopee',
  'Stationery': 'shopee',
}

/**
 * Pick where to buy something.
 *
 * Priority: explicit user override > recorded prices (cheapest, SGD-normalised)
 * > category default. We only claim a saving when we actually have two prices
 * to compare.
 */
export interface StorePick {
  store: StoreKey
  estSgd: number | null
  savingNote: string | null
  /** Every price we know, cheapest first — so a message can show the compare. */
  alternatives: { store: StoreKey; sgd: number }[]
  /** Chosen price versus the dearest known one, SGD per unit. */
  saving: number | null
}

export function pickStore(item: Item, s: Settings): StorePick {
  const refs = (item.priceRefs ?? []).filter(r => Number.isFinite(r.price) && r.price > 0)
  const alternatives = refs
    .map(r => ({ store: r.store, sgd: toSgd(r.price, r.currency, s) }))
    .sort((a, b) => a.sgd - b.sgd)

  const spread = alternatives.length > 1
    ? alternatives[alternatives.length - 1].sgd - alternatives[0].sgd
    : 0

  if (item.storeHint) {
    const ref = refs.find(r => r.store === item.storeHint)
    return {
      store: item.storeHint,
      estSgd: ref ? toSgd(ref.price, ref.currency, s) : null,
      savingNote: null,
      alternatives,
      saving: null,
    }
  }

  const best = cheapestRef(refs, s)
  if (best) {
    return {
      store: best.ref.store,
      estSgd: best.sgd,
      savingNote: spread > 0.05 ? `saves ~$${spread.toFixed(2)} vs dearest` : null,
      alternatives,
      saving: spread > 0.05 ? spread : null,
    }
  }

  return {
    store: CATEGORY_STORE[item.category] ?? 'ntuc',
    estSgd: null, savingNote: null, alternatives, saving: null,
  }
}

export interface ShoppingPlan {
  lines: ShoppingLine[]
  byTrip: Record<TripKey, ShoppingLine[]>
  totals: Record<TripKey, number>
  /** True when the JB basket clears the "worth the causeway" threshold. */
  jbWorthIt: boolean
  /** JB lines folded back into the SG trip because the basket was too small. */
  jbFolded: ShoppingLine[]
}

export function buildShoppingPlan(
  items: Item[],
  s: Settings,
  extraManual: { itemId: string; qty: number }[] = [],
): ShoppingPlan {
  const manual = new Map(extraManual.map(m => [m.itemId, m.qty]))
  const lines: ShoppingLine[] = []

  for (const item of items) {
    if (item.archived) continue
    if (item.notify === 'never') continue
    const status = stockStatus(item, s)
    const forced = manual.get(item.id)
    const auto = status === 'out' || status === 'low' || status === 'expired'
    if (!forced && !auto) continue

    const qty = forced ?? restockQty(item)
    if (qty <= 0) continue

    const { store, estSgd, savingNote, alternatives, saving } = pickStore(item, s)
    lines.push({
      itemId: item.id,
      name: [item.brand, item.name].filter(Boolean).join(' '),
      qty,
      unit: item.unit,
      store,
      trip: storeTrip(store),
      estSgd: estSgd !== null ? estSgd * qty : null,
      reason: forced ? 'manual' : (status === 'ok' ? 'low' : status === 'expired' ? 'out' : status as Exclude<StockStatus, 'ok' | 'expired'>),
      url: storeSearchUrl(store, item),
      savingNote,
      alternatives,
      saving: saving !== null ? saving * qty : null,
    })
  }

  const byTrip: Record<TripKey, ShoppingLine[]> = { sg: [], jb: [], online: [] }
  for (const l of lines) byTrip[l.trip].push(l)

  const sum = (ls: ShoppingLine[]) => ls.reduce((a, l) => a + (l.estSgd ?? 0), 0)
  const jbTotal = sum(byTrip.jb)

  // A JB run costs you petrol, tolls and two hours of queueing. Only send the
  // user across if the basket justifies it; otherwise fold it into the SG trip.
  const jbWorthIt = jbTotal >= s.jbMinBasketSgd || byTrip.jb.length >= 12
  let jbFolded: ShoppingLine[] = []
  if (!jbWorthIt && byTrip.jb.length) {
    // Folded lines are now bought in Singapore, so the JB price is no longer
    // on offer. Drop the comparison rather than advertising a saving that is
    // not available on this trip.
    jbFolded = byTrip.jb.map(l => ({
      ...l, trip: 'sg' as TripKey, store: 'ntuc' as StoreKey,
      savingNote: null, alternatives: [], saving: null,
      estSgd: (l.alternatives ?? []).find(a => a.store === 'ntuc')?.sgd
        ? (l.alternatives ?? []).find(a => a.store === 'ntuc')!.sgd * l.qty
        : l.estSgd,
    }))
    byTrip.sg = byTrip.sg.concat(jbFolded)
    byTrip.jb = []
  }

  for (const k of Object.keys(byTrip) as TripKey[]) {
    byTrip[k].sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    lines,
    byTrip,
    totals: { sg: sum(byTrip.sg), jb: sum(byTrip.jb), online: sum(byTrip.online) },
    jbWorthIt,
    jbFolded,
  }
}

export interface UseSoonEntry {
  item: Item
  locationName: string
  reason: 'expiring' | 'expired' | 'forgotten'
  detail: string
}

/**
 * Requirement 5: nag me about things sitting in storage, but not the winter
 * gear. Two sources — real expiry dates, and "you have not touched this in
 * months and it is not seasonal".
 */
export function buildUseSoon(
  items: Item[],
  locations: Map<string, StorageLocation>,
  s: Settings,
): UseSoonEntry[] {
  const out: UseSoonEntry[] = []
  for (const item of items) {
    if (item.archived || item.qty <= 0) continue
    const loc = item.locationId ? locations.get(item.locationId) : undefined
    const locationName = loc?.name ?? 'Unfiled'

    const d = daysUntil(item.expiryDate)
    if (d !== null && d < 0) {
      out.push({ item, locationName, reason: 'expired', detail: `expired ${Math.abs(Math.round(d))}d ago` })
      continue
    }
    if (d !== null && d <= s.expiryWarnDays) {
      out.push({ item, locationName, reason: 'expiring', detail: `expires in ${Math.round(d)}d` })
      continue
    }
    if (needsUseNudge(item, !!loc?.longTerm, s)) {
      out.push({ item, locationName, reason: 'forgotten', detail: 'untouched in storage' })
    }
  }
  const rank = { expired: 0, expiring: 1, forgotten: 2 }
  return out.sort((a, b) => rank[a.reason] - rank[b.reason])
}

// --- Shopee sale timing ----------------------------------------------------

/**
 * Shopee's big campaigns land on the double-date days — 1/1, 2/2 … 12/12 —
 * and the sale is open the day either side. Worth waiting for on anything
 * that is merely low; not worth waiting for on anything you have run out of.
 */
export interface SalePhase {
  /** Today falls inside a sale window. */
  live: boolean
  /** Days until the next window opens. 0 when live. */
  daysUntilStart: number
  /** How the campaign is spoken about, e.g. "8.8". */
  label: string
}

const epochDay = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)

export function shopeeSale(y: number, m: number, d: number): SalePhase {
  const today = epochDay(y, m, d)
  let live = false
  let best: { start: number; label: string } | null = null

  // Span adjacent years so late December sees 1/1 and early January sees 12/12.
  for (const year of [y - 1, y, y + 1]) {
    for (let mm = 1; mm <= 12; mm++) {
      const centre = epochDay(year, mm, mm)   // e.g. 8 Aug for 8.8
      const label = `${mm}.${mm}`
      if (today >= centre - 1 && today <= centre + 1) { live = true; best = { start: centre - 1, label } }
      else if (centre - 1 > today && (!best || centre - 1 < best.start)) {
        if (!live) best = { start: centre - 1, label }
      }
    }
  }
  if (!best) return { live: false, daysUntilStart: 999, label: '' }
  return { live, daysUntilStart: live ? 0 : best.start - today, label: best.label }
}

/**
 * Should this line wait for the sale?
 *
 * Only if it is an online purchase, the sale is close, and you are not
 * actually out of the thing. Running out beats saving a dollar.
 */
export function shouldWaitForSale(line: ShoppingLine, sale: SalePhase, maxWaitDays = 10): boolean {
  return line.trip === 'online'
    && !sale.live
    && line.reason !== 'out'
    && sale.daysUntilStart <= maxWaitDays
}
