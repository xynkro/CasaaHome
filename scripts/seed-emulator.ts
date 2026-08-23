/**
 * Fill the Firestore emulator with a believable house.
 *
 * Testing on a real phone needs data, and the emulator forgets everything when
 * it restarts — which it does every time the machine sleeps. Re-seeding by hand
 * wastes more time than writing this did.
 *
 *   npm run seed:emu
 *
 * Writes through the emulator's REST API as `owner`, which bypasses rules, so
 * it does not need a signed-in user. Refuses to run against anything but the
 * local emulator.
 */
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
if (!/^(127\.0\.0\.1|localhost)\b/.test(HOST)) {
  console.error(`Refusing to seed ${HOST} — this only ever talks to the emulator.`)
  process.exit(1)
}
const BASE = `http://${HOST}/v1/projects/casaahome/databases/(default)/documents`

type J = string | number | boolean | null | J[] | { [k: string]: J }
const val = (v: J): unknown => {
  if (v === null) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } }
}
async function put(path: string, doc: Record<string, J>) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, val(v)])) }),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
}

const now = new Date().toISOString()
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

// Caspar's actual rooms, in the order he listed them.
const ROOMS = ['Living Room', 'Dining Room', 'Lounge', 'Kitchen', 'Yard', 'Yard Toilet',
  'Helpers Room', 'Corridor Store', 'Common Toilet', 'Master Toilet', 'Master', 'Guest',
  'Study', 'Balcony']

const LOCS: [string, string, string, string, string][] = [
  ['l1', 'Kitchen tall cabinet', 'r03', 'cabinet', '#cups #teacups #wine'],
  ['l2', 'Fridge', 'r03', 'fridge', '#milk #eggs'],
  ['l3', 'Under the sink, left of the hob', 'r03', 'cabinet', '#detergent #sponges'],
  ['l4', 'Corridor store top shelf', 'r07', 'shelf', '#luggage #christmas'],
  ['l5', 'Master wardrobe left', 'r10', 'wardrobe', '#towels #bedsheets'],
  ['l6', 'Study drawer unit', 'r12', 'drawer', '#cables #batteries'],
]

const ITEMS: [string, string, string, string, string, number, string, number, number][] = [
  ['i1', 'Jasmine rice 5kg', '', 'Pantry', 'l1', 0, 'bag', 2, 1],
  ['i2', 'Cooking oil 2L', 'Knife', 'Pantry', 'l1', 1, 'bottle', 3, 2],
  ['i3', 'Fresh milk 1L', 'Meiji', 'Fridge', 'l2', 2, 'bottle', 4, 2],
  ['i4', 'Sea salt', '', 'Pantry', 'l1', 6, 'box', 2, 1],
  ['i5', 'Laundry detergent', 'Dynamo', 'Laundry', 'l3', 1, 'bottle', 3, 2],
  ['i6', 'AA batteries', '', 'Electrical', 'l6', 2, 'pcs', 12, 4],
]

await put('house/plan', {
  rooms: ROOMS.map((name, i) => ({ id: `r${String(i).padStart(2, '0')}`, name })),
  walls: [], metresPerPixel: 0.01, planImageUrl: null, updatedAt: now,
})
await put('config/access', {
  emails: ['the.disruptive.comp@gmail.com', 'xynkro@gmail.com', 'sarah.sanusi@gmail.com'],
})
await put('config/settings', {
  householdName: 'Casaa', nicknames: { 'the.disruptive.comp@gmail.com': 'Caspar' },
  lowCoverDays: 10, expiryWarnDays: 7, staleVerifyDays: 45, storageNudgeDays: 180, updatedAt: now,
})
for (const [id, name, roomId, kind, contents] of LOCS) {
  await put(`locations/${id}`, {
    name, roomId, kind, parentId: null, contents, notes: '', photoUrls: [],
    longTerm: id === 'l4', createdAt: ago(30), updatedAt: now,
  })
}
for (const [id, name, brand, category, locationId, qty, unit, parLevel, minQty] of ITEMS) {
  await put(`items/${id}`, {
    name, brand, category, locationId, tags: [], qty, unit, parLevel, minQty,
    perishable: false, expiryDate: null, seasonal: false, archived: false,
    notes: '', photoUrls: [], priceRefs: [], history: [],
    createdAt: ago(60), updatedAt: ago(2), lastVerifiedAt: ago(2),
  })
}
console.log(`Seeded ${ROOMS.length} rooms, ${LOCS.length} places, ${ITEMS.length} items into ${HOST}.`)
