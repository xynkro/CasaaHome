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
export function pickStore(item: Item, s: Settings): { store: StoreKey; estSgd: number | null; savingNote: string | null } {
  if (item.storeHint) {
    const ref = (item.priceRefs ?? []).find(r => r.store === item.storeHint)
    return {
      store: item.storeHint,
      estSgd: ref ? toSgd(ref.price, ref.currency, s) : null,
      savingNote: null,
    }
  }

  const refs = item.priceRefs ?? []
  const best = cheapestRef(refs, s)
  if (best) {
    let savingNote: string | null = null
    if (refs.length > 1) {
      const others = refs
        .filter(r => r !== best.ref)
        .map(r => toSgd(r.price, r.currency, s))
        .filter(n => Number.isFinite(n))
      if (others.length) {
        const worst = Math.max(...others)
        const diff = worst - best.sgd
        if (diff > 0.05) savingNote = `saves ~$${diff.toFixed(2)} vs dearest`
      }
    }
    return { store: best.ref.store, estSgd: best.sgd, savingNote }
  }

  return { store: CATEGORY_STORE[item.category] ?? 'ntuc', estSgd: null, savingNote: null }
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
    const status = stockStatus(item, s)
    const forced = manual.get(item.id)
    const auto = status === 'out' || status === 'low' || status === 'expired'
    if (!forced && !auto) continue

    const qty = forced ?? restockQty(item)
    if (qty <= 0) continue

    const { store, estSgd, savingNote } = pickStore(item, s)
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
    jbFolded = byTrip.jb.map(l => ({ ...l, trip: 'sg' as TripKey, store: 'ntuc' as StoreKey, savingNote: null }))
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
