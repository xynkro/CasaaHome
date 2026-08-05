import { DEFAULT_SETTINGS, type Item, type StockEvent, type StorageLocation } from '../src/types'
import { estimateBurnPerDay, stockStatus, daysOfCover } from '../src/lib/stock'
import { buildShoppingPlan, buildUseSoon } from '../src/lib/shopping'
import { shopeeSale, shouldWaitForSale, pickStore } from '../src/lib/shopping'
import type { ShoppingLine } from '../src/types'

const S = { ...DEFAULT_SETTINGS }
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString()
let fails = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}`, cond ? '' : JSON.stringify(extra))
  if (!cond) fails++
}

const mkItem = (p: Partial<Item>): Item => ({
  id: p.id ?? 'x', name: p.name ?? 'thing', category: p.category ?? 'Pantry', tags: [],
  locationId: p.locationId ?? null, qty: p.qty ?? 5, unit: 'pcs',
  parLevel: p.parLevel ?? 6, minQty: p.minQty ?? 2, perishable: false,
  expiryDate: p.expiryDate ?? null, photoUrls: [], priceRefs: p.priceRefs ?? [],
  seasonal: p.seasonal, storeHint: p.storeHint ?? null, burnPerDay: p.burnPerDay ?? null,
  lastVerifiedAt: p.lastVerifiedAt ?? iso(1),
  createdAt: iso(60), updatedAt: p.updatedAt ?? iso(1),
  ...p,
} as Item)

// --- burn rate -----------------------------------------------------------
const ev = (d: number, before: number, after: number, type: StockEvent['type'] = 'reconcile'): StockEvent =>
  ({ id: String(d), itemId: 'x', type, qtyBefore: before, qtyAfter: after, delta: after - before, at: iso(d), by: 'me' })

// Bought 10, 20 days later only 2 left => 8 used over 20 days = 0.4/day
const burn = estimateBurnPerDay([ev(20, 0, 10, 'restock'), ev(0, 10, 2)])
check('burn rate from one honest correction', Math.abs((burn ?? 0) - 0.4) < 0.001, burn)

// A restock must not read as consumption
const burn2 = estimateBurnPerDay([ev(20, 5, 5), ev(0, 5, 30, 'restock')])
check('restock is not consumption', burn2 === null, burn2)

// Too little evidence
check('needs >=2 events', estimateBurnPerDay([ev(5, 10, 8)]) === null)
check('needs >=3 days span', estimateBurnPerDay([ev(1, 10, 8), ev(0, 8, 7)]) === null)

// --- status ---------------------------------------------------------------
check('out', stockStatus(mkItem({ qty: 0 }), S) === 'out')
check('low by minQty', stockStatus(mkItem({ qty: 2, minQty: 2 }), S) === 'low')
check('ok', stockStatus(mkItem({ qty: 5, minQty: 2 }), S) === 'ok')
check('expiring', stockStatus(mkItem({ qty: 5, expiryDate: iso(-3) }), S) === 'expiring')
check('expired', stockStatus(mkItem({ qty: 5, expiryDate: iso(3) }), S) === 'expired')
// 0.5/day burn, 4 left = 8 days cover < lowCoverDays(10) => low even though above minQty
const fast = mkItem({ qty: 4, minQty: 1, burnPerDay: 0.5 })
check('low by days-of-cover', stockStatus(fast, S) === 'low', daysOfCover(fast))

// --- shopping plan --------------------------------------------------------
const items: Item[] = [
  mkItem({ id: 'rice', name: 'Rice', qty: 0, parLevel: 2, category: 'Pantry' }),
  mkItem({ id: 'soap', name: 'Soap', qty: 1, minQty: 2, parLevel: 6, category: 'Cleaning',
    priceRefs: [
      { store: 'ntuc', price: 8, currency: 'SGD', checkedAt: iso(5) },
      { store: 'giant_jb', price: 16.75, currency: 'MYR', checkedAt: iso(5) }, // = S$5.00
    ] }),
  mkItem({ id: 'ok', name: 'Salt', qty: 9, minQty: 1 }),
]
const plan = buildShoppingPlan(items, S)
check('only short items listed', plan.lines.length === 2, plan.lines.map(l => l.itemId))
const soap = plan.lines.find(l => l.itemId === 'soap')!
check('routes to cheaper JB price', soap.store === 'giant_jb', soap)
check('qty tops up to par', soap.qty === 5, soap.qty)
check('estimate uses SGD equivalent', Math.abs((soap.estSgd ?? 0) - 25) < 0.01, soap.estSgd)
check('small JB basket folded into SG', plan.byTrip.jb.length === 0 && plan.jbFolded.length === 1)

const bigS = { ...S, jbMinBasketSgd: 5 }
const plan2 = buildShoppingPlan(items, bigS)
check('JB kept when basket clears threshold', plan2.byTrip.jb.length === 1 && plan2.jbWorthIt)

// --- use-soon -------------------------------------------------------------
const locs = new Map<string, StorageLocation>([
  ['store', { id: 'store', name: 'Store room', kind: 'store', roomId: null, parentId: null,
    photoUrls: [], longTerm: true, createdAt: iso(400), updatedAt: iso(400) }],
])
const stored: Item[] = [
  mkItem({ id: 'winter', name: 'Winter coat', locationId: 'store', seasonal: true, updatedAt: iso(300), lastVerifiedAt: iso(300) }),
  mkItem({ id: 'noodles', name: 'Instant noodles', locationId: 'store', updatedAt: iso(300), lastVerifiedAt: iso(300) }),
]
const soon = buildUseSoon(stored, locs, S)
check('nags forgotten pantry stock', soon.some(e => e.item.id === 'noodles'))
check('never nags seasonal', !soon.some(e => e.item.id === 'winter'), soon.map(e => e.item.id))



// --- Shopee sale windows --------------------------------------------------

const sale = (y: number, m: number, d: number) => shopeeSale(y, m, d)
check('8.8 itself is live',        sale(2026, 8, 8).live)
check('day before 8.8 is live',    sale(2026, 8, 7).live)
check('day after 8.8 is live',     sale(2026, 8, 9).live)
check('two days before is not',   !sale(2026, 8, 6).live, sale(2026,8,6))
check('two days after is not',    !sale(2026, 8, 10).live)
check('label names the campaign',  sale(2026, 8, 8).label === '8.8', sale(2026,8,8).label)
// 6 Aug -> next window opens 7 Aug
check('counts days to next window', sale(2026, 8, 6).daysUntilStart === 1, sale(2026,8,6))
// 10 Aug -> next is 9.9, window opens 8 Sep = 29 days
check('rolls to the next month',    sale(2026, 8, 10).daysUntilStart === 29, sale(2026,8,10))
// 28 Dec -> next is 1.1 next year, opens 31 Dec = 3 days
check('crosses the year boundary',  sale(2026, 12, 28).daysUntilStart === 3, sale(2026,12,28))
check('31 Dec is inside the 1.1 window', sale(2026, 12, 31).live)
check('2 Jan is inside the 1.1 window',  sale(2026, 1, 2).live)
check('12.12 works',                sale(2026, 12, 12).live && sale(2026,12,12).label === '12.12')

const line = (p: Partial<ShoppingLine>): ShoppingLine => ({
  itemId:'x', name:'thing', qty:1, unit:'pcs', store:'shopee', trip:'online',
  estSgd:5, reason:'low', ...p,
} as ShoppingLine)
check('waits when a sale is near',   shouldWaitForSale(line({}), sale(2026,8,4), 10))
check('never waits when out',       !shouldWaitForSale(line({reason:'out'}), sale(2026,8,4), 10))
check('never waits in-store',       !shouldWaitForSale(line({trip:'sg'}), sale(2026,8,4), 10))
check('no wait when sale is live',  !shouldWaitForSale(line({}), sale(2026,8,8), 10))
check('no wait when sale is far',   !shouldWaitForSale(line({}), sale(2026,8,20), 10), sale(2026,8,20))

// --- price comparison -----------------------------------------------------
const twoPrices = mkItem({ qty:0, priceRefs:[
  { store:'shopee', price:4.20, currency:'SGD', checkedAt: iso(2) },
  { store:'ntuc',   price:5.90, currency:'SGD', checkedAt: iso(2) },
]})
const pick = pickStore(twoPrices, S)
check('picks the cheaper of the two', pick.store === 'shopee', pick.store)
check('reports the spread', Math.abs((pick.saving ?? 0) - 1.70) < 0.001, pick.saving)
check('lists alternatives cheapest first',
  pick.alternatives.map(a=>a.store).join(',') === 'shopee,ntuc', pick.alternatives)

const never = buildShoppingPlan([mkItem({ id:'quiet', qty:0, notify:'never' })], S)
check('notify:never stays out of the list', never.lines.length === 0, never.lines)

console.log(fails === 0 ? '\nAll logic checks passed.' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
