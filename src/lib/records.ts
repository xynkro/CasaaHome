import type { Item, StorageLocation } from '../types'

/**
 * The shape a brand-new document takes.
 *
 * These used to be inline object literals in the store that named every field
 * explicitly — a whitelist. That reads as careful and is in fact a trap: adding
 * a field to the type and to the form does NOT add it to the whitelist, and
 * nothing complains. `contents` and `shots` were added to StorageLocation for
 * the camera-first flow and never reached Firestore, so every cupboard Caspar
 * photographed saved with no photo and no tags, silently, exactly as if the
 * save button did nothing.
 *
 * So: defaults first, then the caller's patch spread over the top. A new
 * optional field now arrives by default and has to be deliberately excluded
 * rather than deliberately included.
 *
 * `defined` matters as much as the merge — Firestore rejects a write whose
 * value is `undefined`, and an optional field the form left alone is exactly
 * that, so the whole save would throw on a field nobody filled in.
 */
export function defined<T extends object>(o: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as Partial<T>
}

/**
 * `defined` one level down is not enough.
 *
 * Firestore rejects `undefined` ANYWHERE in a payload, including inside an
 * object inside an array — and it rejects the whole write, not the one field.
 * `setQty` built a StockEvent with `note: undefined` (no caller has ever passed
 * a note), pushed it into `history[]`, and every count correction in the app
 * therefore threw before it reached the network. The callers await it inside
 * `try/finally` with no `catch`, so it failed in complete silence.
 *
 * Strips undefined recursively. Arrays keep their length and order; `null` is
 * left alone, because null is a value Firestore stores and means something here
 * ("no expiry date" is not the same as "never asked").
 */
export function deepDefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(deepDefined) as unknown as T
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x !== undefined) out[k] = deepDefined(x)
    }
    return out as T
  }
  return v
}

export function newLocationRecord(
  patch: Partial<StorageLocation>,
  ts: string,
): Omit<StorageLocation, 'id'> {
  const base: Omit<StorageLocation, 'id'> = {
    name: 'New place',
    kind: 'cabinet',
    roomId: null,
    parentId: null,
    pos: null,
    pin: null,
    photoUrls: [],
    shots: { open: null, closed: null },
    contents: '',
    notes: '',
    longTerm: false,
    createdAt: ts,
    updatedAt: ts,
  }
  const { id: _id, ...rest } = patch as Partial<StorageLocation> & { id?: string }
  return { ...base, ...defined(rest), createdAt: ts, updatedAt: ts }
}

export function newItemRecord(patch: Partial<Item>, ts: string): Omit<Item, 'id'> {
  const base: Omit<Item, 'id'> = {
    name: 'Untitled',
    brand: '',
    category: 'Other',
    tags: [],
    locationId: null,
    qty: 1,
    unit: 'pcs',
    parLevel: Math.max(patch.qty ?? 1, 1),
    minQty: 1,
    perishable: false,
    expiryDate: null,
    openedAt: null,
    photoUrls: [],
    notes: '',
    barcode: null,
    seasonal: false,
    storeHint: null,
    shopeeUrl: null,
    priceRefs: [],
    lastVerifiedAt: ts,
    burnPerDay: null,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
  }
  const { id: _id, ...rest } = patch as Partial<Item> & { id?: string }
  return { ...base, ...defined(rest), lastVerifiedAt: ts, createdAt: ts, updatedAt: ts }
}
