/**
 * New documents must carry everything the forms collect.
 *
 * The store used to build creates from an explicit whitelist of fields. That
 * silently dropped `contents` and `shots` when the camera-first flow started
 * sending them, so every photographed cupboard saved with no photo and no tags
 * and the save button looked broken. Nothing failed; the data just was not
 * there. These checks are the thing that was missing.
 */
import { deepDefined, defined, newItemRecord, newLocationRecord } from '../src/lib/records'
import type { Item, StorageLocation } from '../src/types'

let fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok  ${name}`)
  else { fail++; console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const TS_ = '2026-08-11T00:00:00.000Z'

console.log('records: a photographed cupboard')
{
  // Exactly what SnapPlace sends.
  const patch: Partial<StorageLocation> = {
    name: 'Under the sink, left of the hob',
    kind: 'cabinet',
    roomId: 'r03',
    parentId: null,
    contents: '#detergent #sponges',
    shots: { open: 'https://example.test/a.jpg', closed: null },
    photoUrls: [],
  }
  const rec = newLocationRecord(patch, TS_) as Record<string, unknown>
  ok('keeps the photo', (rec.shots as { open?: string })?.open === 'https://example.test/a.jpg')
  ok('keeps the tags', rec.contents === '#detergent #sponges')
  ok('keeps the room', rec.roomId === 'r03')
  ok('keeps the name', rec.name === 'Under the sink, left of the hob')
  ok('still fills in defaults it was not given', rec.longTerm === false && rec.notes === '')
  ok('stamps both timestamps', rec.createdAt === TS_ && rec.updatedAt === TS_)
}

console.log('records: a pin dropped on a room photo')
{
  const rec = newLocationRecord({ name: 'Fridge', pin: { x: 0.25, y: 0.7 } }, TS_) as Record<string, unknown>
  ok('keeps the pin', JSON.stringify(rec.pin) === '{"x":0.25,"y":0.7}')
}

console.log('records: a tagged item')
{
  const patch: Partial<Item> = {
    name: 'Jasmine rice 5kg', qty: 2, unit: 'bag', category: 'Pantry',
    locationId: 'l1', parLevel: 2, minQty: 1,
    notes: '#rice #staples', tags: ['rice', 'staples'],
  }
  const rec = newItemRecord(patch, TS_) as Record<string, unknown>
  ok('keeps the name', rec.name === 'Jasmine rice 5kg')
  ok('keeps the tags array', JSON.stringify(rec.tags) === '["rice","staples"]')
  ok('keeps the raw tag line', rec.notes === '#rice #staples')
  ok('keeps the cupboard', rec.locationId === 'l1')
  ok('defaults the rest', rec.archived === false && rec.burnPerDay === null)
}

console.log('records: nothing undefined ever reaches Firestore')
{
  // Firestore rejects the whole write if any value is undefined, so an optional
  // field the form left alone would throw on a field nobody touched.
  const scan = (o: object, path = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v === undefined ? [`${path}${k}`]
        : v && typeof v === 'object' && !Array.isArray(v) ? scan(v, `${path}${k}.`)
        : [])

  const cases: Record<string, object> = {
    'bare location': newLocationRecord({}, TS_),
    'bare item': newItemRecord({}, TS_),
    'location with undefined optionals': newLocationRecord(
      { name: 'X', shots: undefined, contents: undefined, pin: undefined, pos: undefined }, TS_),
    'item with undefined optionals': newItemRecord(
      { name: 'Y', notes: undefined, tags: undefined, expiryDate: undefined }, TS_),
  }
  for (const [label, rec] of Object.entries(cases)) {
    const bad = scan(rec)
    ok(`${label} has no undefined`, bad.length === 0, bad.join(', '))
  }
  ok('defined() strips undefined but keeps null and 0 and empty string',
    JSON.stringify(defined({ a: undefined, b: null, c: 0, d: '', e: false }))
      === '{"b":null,"c":0,"d":"","e":false}')
}

console.log('records: undefined nested inside an array')
{
  // The exact payload setQty builds. Firestore rejects undefined ANYWHERE,
  // including inside an object inside an array, and rejects the whole write —
  // so this made every count correction throw, silently, for every caller.
  const ev = {
    id: 'e1', itemId: 'i1', type: 'reconcile', qtyBefore: 6, qtyAfter: 2,
    delta: -4, at: TS_, by: 'a@b.c', note: undefined,
  }
  const payload = deepDefined({ qty: 2, history: [ev], burnPerDay: null, updatedAt: TS_ })

  const scan = (o: unknown, path = ''): string[] => {
    if (Array.isArray(o)) return o.flatMap((x, i) => scan(x, `${path}[${i}]`))
    if (o && typeof o === 'object') {
      return Object.entries(o as Record<string, unknown>)
        .flatMap(([k, v]) => (v === undefined ? [`${path}.${k}`] : scan(v, `${path}.${k}`)))
    }
    return []
  }
  const bad = scan(payload)
  ok('strips undefined from inside an array', bad.length === 0, bad.join(', '))
  ok('the event survives otherwise',
    (payload.history[0] as Record<string, unknown>).qtyAfter === 2
    && (payload.history[0] as Record<string, unknown>).by === 'a@b.c')
  ok('the array keeps its length', payload.history.length === 1)
  ok('null is preserved, because null means something',
    payload.burnPerDay === null
    && (deepDefined({ a: null, b: 0, c: '', d: false }) as Record<string, unknown>).a === null)
  ok('a note that exists is kept',
    (deepDefined({ history: [{ ...ev, note: 'found 2 at the back' }] }).history[0] as Record<string, unknown>).note
      === 'found 2 at the back')
  ok('deepDefined leaves primitives and dates alone',
    deepDefined(3) === 3 && deepDefined('x') === 'x' && deepDefined(null) === null)
}

console.log('records: an id in the patch never becomes a field')
{
  const loc = newLocationRecord({ id: 'abc', name: 'X' } as Partial<StorageLocation>, TS_)
  const item = newItemRecord({ id: 'def', name: 'Y' } as Partial<Item>, TS_)
  ok('location drops id', !('id' in loc))
  ok('item drops id', !('id' in item))
}

if (fail) { console.error(`${fail} record checks failed`); process.exit(1) }
console.log('All record checks passed.')
