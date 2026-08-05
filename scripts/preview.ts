/**
 * Render the weekly digest from sample data.
 *
 * Uses the same formatting the bot uses, so the wording and the sale timing
 * can be checked without a service account, a bot token, or touching the real
 * inventory.
 *
 *   npm run preview            # today
 *   npm run preview 2026-08-08 # pretend it is 8.8
 */

import { DEFAULT_SETTINGS, type Item, type Settings, type StorageLocation, type TripKey } from '../src/types'
import { buildShoppingPlan, buildUseSoon, shopeeSale } from '../src/lib/shopping'
import { tripMessage, useSoonMessage } from '../src/lib/digest'

const arg = process.argv[2]
const [Y, M, D] = arg
  ? arg.split('-').map(Number)
  : (() => { const n = new Date(); return [n.getFullYear(), n.getMonth() + 1, n.getDate()] })()

const S: Settings = { ...DEFAULT_SETTINGS, householdName: 'Casaa' }
const iso = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

const item = (p: Partial<Item>): Item => ({
  id: p.name!, name: 'thing', category: 'Pantry', tags: [], locationId: 'store',
  qty: 0, unit: 'pcs', parLevel: 2, minQty: 1, perishable: false, expiryDate: null,
  photoUrls: [], priceRefs: [], createdAt: iso(90), updatedAt: iso(2), lastVerifiedAt: iso(2),
  ...p,
} as Item)

const items: Item[] = [
  item({ name: 'Jasmine rice 5kg', qty: 0, unit: 'bag', parLevel: 2, category: 'Pantry',
    priceRefs: [{ store: 'ntuc', price: 12.9, currency: 'SGD', checkedAt: iso(9) }] }),
  item({ name: 'Laundry detergent', brand: 'Dynamo', qty: 1, minQty: 2, parLevel: 3, unit: 'bottle',
    category: 'Laundry', priceRefs: [
      { store: 'ntuc', price: 14.9, currency: 'SGD', checkedAt: iso(20) },
      { store: 'giant_jb', price: 32, currency: 'MYR', checkedAt: iso(20) }] }),
  item({ name: 'AA batteries', qty: 2, minQty: 4, parLevel: 12, category: 'Electrical',
    priceRefs: [
      { store: 'shopee', price: 4.20, currency: 'SGD', checkedAt: iso(3) },
      { store: 'ntuc', price: 5.90, currency: 'SGD', checkedAt: iso(3) }] }),
  item({ name: 'Cat litter', qty: 0, minQty: 1, parLevel: 2, unit: 'bag', category: 'Pet',
    priceRefs: [{ store: 'shopee', price: 18.5, currency: 'SGD', checkedAt: iso(5) }] }),
  item({ name: 'Fresh milk 1L', qty: 1, minQty: 2, parLevel: 4, unit: 'bottle', category: 'Fridge',
    expiryDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    locationId: 'fridge' }),
]

const locations = new Map<string, StorageLocation>([
  ['store', { id: 'store', name: 'Store room rack', kind: 'rack', roomId: null, parentId: null,
    photoUrls: [], longTerm: true, createdAt: iso(400), updatedAt: iso(400) }],
  ['fridge', { id: 'fridge', name: 'Fridge', kind: 'fridge', roomId: null, parentId: null,
    photoUrls: [], createdAt: iso(400), updatedAt: iso(400) }],
])

const plan = buildShoppingPlan(items, S)
const sale = shopeeSale(Y, M, D)
const strip = (s: string) => s.replace(/<[^>]+>/g, '')

console.log(`\n${'='.repeat(58)}`)
console.log(`  Digest as it would read on ${Y}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')} (SGT)`)
console.log(`  Shopee: ${sale.live ? `${sale.label} SALE LIVE` : `next ${sale.label} in ${sale.daysUntilStart}d`}`)
console.log('='.repeat(58))

console.log(`\n🏠 ${S.householdName} — weekly list`)
console.log(`${plan.lines.length} things to restock.`)
if (sale.live) console.log(`🔥 Shopee ${sale.label} sale is live today.`)

for (const trip of ['sg', 'jb', 'online'] as TripKey[]) {
  const msg = tripMessage(trip, plan, items, sale, S)
  if (msg) console.log('\n' + '-'.repeat(58) + '\n' + strip(msg))
}
const use = useSoonMessage(buildUseSoon(items, locations, S))
if (use) console.log('\n' + '-'.repeat(58) + '\n' + strip(use))
console.log()
