import type { Item, PriceRef, Settings, StoreKey } from '../types'
import { STORES } from '../types'

const enc = (s: string) => encodeURIComponent(s.trim())

/**
 * Deep links. Note deliberately: none of these retailers expose a public,
 * stable price API, so we link to a *search* the user can land on in one tap
 * rather than pretending to know a live price. Once you paste a direct
 * product URL onto an item, that wins forever after.
 */
export function shopeeSearch(item: Pick<Item, 'name' | 'brand' | 'shopeeUrl'>): string {
  if (item.shopeeUrl) return item.shopeeUrl
  const q = [item.brand, item.name].filter(Boolean).join(' ')
  return `https://shopee.sg/search?keyword=${enc(q)}`
}

export function fairpriceSearch(item: Pick<Item, 'name' | 'brand'>): string {
  const q = [item.brand, item.name].filter(Boolean).join(' ')
  return `https://www.fairprice.com.sg/search?query=${enc(q)}`
}

export function giantMySearch(item: Pick<Item, 'name' | 'brand'>): string {
  const q = [item.brand, item.name].filter(Boolean).join(' ')
  return `https://giant.com.my/search?q=${enc(q)}`
}

export function storeSearchUrl(store: StoreKey, item: Item): string | null {
  switch (store) {
    case 'shopee': return shopeeSearch(item)
    case 'ntuc': return fairpriceSearch(item)
    case 'giant_jb': return giantMySearch(item)
    case 'jusco_jb': return null // AEON MY has no usable public search URL
    default: return null
  }
}

export function toSgd(price: number, currency: string, s: Settings): number {
  if (currency === 'MYR') return price / (s.myrPerSgd || 3.35)
  return price
}

export function cheapestRef(refs: PriceRef[], s: Settings): { ref: PriceRef; sgd: number } | null {
  let best: { ref: PriceRef; sgd: number } | null = null
  for (const r of refs ?? []) {
    if (!Number.isFinite(r.price) || r.price <= 0) continue
    const sgd = toSgd(r.price, r.currency, s)
    if (!best || sgd < best.sgd) best = { ref: r, sgd }
  }
  return best
}

export function storeLabel(key: StoreKey): string {
  return STORES.find(s => s.key === key)?.label ?? key
}

export function storeShort(key: StoreKey): string {
  return STORES.find(s => s.key === key)?.short ?? key
}

export function storeTrip(key: StoreKey) {
  return STORES.find(s => s.key === key)?.trip ?? 'sg'
}
