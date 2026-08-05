// ---------------------------------------------------------------------------
// CasaaHome domain model
// ---------------------------------------------------------------------------

export type Unit =
  | 'pcs' | 'pack' | 'box' | 'bottle' | 'can' | 'roll' | 'bag'
  | 'g' | 'kg' | 'ml' | 'l'

export const UNITS: Unit[] = [
  'pcs', 'pack', 'box', 'bottle', 'can', 'roll', 'bag', 'g', 'kg', 'ml', 'l',
]

export type StoreKey = 'ntuc' | 'giant_jb' | 'jusco_jb' | 'shopee' | 'other'

export const STORES: { key: StoreKey; label: string; short: string; currency: Currency; trip: TripKey }[] = [
  { key: 'ntuc',     label: 'NTUC FairPrice', short: 'NTUC',   currency: 'SGD', trip: 'sg' },
  { key: 'giant_jb', label: 'Giant (JB)',     short: 'Giant',  currency: 'MYR', trip: 'jb' },
  { key: 'jusco_jb', label: 'AEON/Jusco (JB)',short: 'AEON',   currency: 'MYR', trip: 'jb' },
  { key: 'shopee',   label: 'Shopee',         short: 'Shopee', currency: 'SGD', trip: 'online' },
  { key: 'other',    label: 'Other',          short: 'Other',  currency: 'SGD', trip: 'sg' },
]

export type TripKey = 'sg' | 'jb' | 'online'
export type Currency = 'SGD' | 'MYR'

export interface PriceRef {
  store: StoreKey
  price: number
  currency: Currency
  /** e.g. "1.5L" or "per 500g" — what the price is FOR. */
  unitNote?: string
  url?: string
  checkedAt: string // ISO
}

export type LocationKind =
  | 'cabinet' | 'drawer' | 'shelf' | 'fridge' | 'freezer'
  | 'wardrobe' | 'store' | 'box' | 'rack' | 'other'

export const LOCATION_KINDS: LocationKind[] = [
  'cabinet', 'drawer', 'shelf', 'fridge', 'freezer', 'wardrobe', 'store', 'box', 'rack', 'other',
]

/**
 * How high off the floor something sits.
 *
 * "Upper cupboard" and "the one under the sink" are the same cabinet to a
 * database unless height is recorded, so this is the field that makes the two
 * distinguishable — in the list, in search, and in the 3D view, where the
 * massing is actually mounted at this height.
 */
export type Level = 'floor' | 'low' | 'counter' | 'eye' | 'high'

export const LEVELS: { key: Level; label: string; hint: string; metres: number }[] = [
  { key: 'floor',   label: 'Floor',        hint: 'under the sink, floor boxes', metres: 0.0 },
  { key: 'low',     label: 'Low',          hint: 'drawers, base units',         metres: 0.35 },
  { key: 'counter', label: 'Counter',      hint: 'worktop height',              metres: 0.9 },
  { key: 'eye',     label: 'Upper',        hint: 'wall cupboards, eye level',   metres: 1.5 },
  { key: 'high',    label: 'High',         hint: 'top shelves, above wardrobe', metres: 2.05 },
]

export const levelMetres = (l?: Level | null) =>
  LEVELS.find(x => x.key === l)?.metres ?? 0
export const levelLabel = (l?: Level | null) =>
  LEVELS.find(x => x.key === l)?.label ?? null

/** A physical place things live. Can nest (cabinet > shelf > box). */
export interface StorageLocation {
  id: string
  name: string
  kind: LocationKind
  roomId: string | null
  parentId: string | null
  /** Position in the 3D house, metres. y = height above floor. */
  pos?: { x: number; y: number; z: number } | null
  /** Upper or lower? Drives the mount height in 3D and reads in the list. */
  level?: Level | null
  photoUrls: string[]
  /**
   * The two shots that make a place findable: `closed` so you can recognise
   * it from across the room, `open` so you can see what is in it. Named slots
   * rather than a flat list, so the capture sweep knows what is still missing.
   */
  shots?: { closed?: string | null; open?: string | null }
  notes?: string
  /** Long-term storage: things here get "use me before you forget" nudges. */
  longTerm?: boolean
  createdAt: string
  updatedAt: string
}

export interface Item {
  id: string
  name: string
  brand?: string
  category: string
  tags: string[]
  locationId: string | null

  qty: number
  unit: Unit
  /** Restock target. Shopping list buys back up to this. */
  parLevel: number
  /** At or below this = "low". */
  minQty: number

  perishable: boolean
  expiryDate?: string | null // ISO date
  openedAt?: string | null

  photoUrls: string[]
  notes?: string
  barcode?: string | null

  /** Seasonal/occasional (winter clothes, luggage) — never nagged to "use up". */
  seasonal?: boolean
  storeHint?: StoreKey | null
  shopeeUrl?: string | null
  priceRefs: PriceRef[]

  /** Last time a human physically confirmed the count. */
  lastVerifiedAt?: string | null
  /** Cached consumption estimate, units/day. Recomputed from events. */
  burnPerDay?: number | null

  /**
   * Per-item alerting. 'urgent' pings the moment it goes low rather than
   * waiting for the weekly digest; 'never' keeps it out of Telegram entirely
   * (spare screws do not need announcing).
   */
  notify?: 'default' | 'urgent' | 'never'

  archived?: boolean
  createdAt: string
  updatedAt: string
}

export type StockEventType = 'create' | 'reconcile' | 'use' | 'restock' | 'move'

export interface StockEvent {
  id: string
  itemId: string
  type: StockEventType
  qtyBefore: number
  qtyAfter: number
  delta: number
  at: string // ISO
  by: string // display name / email
  note?: string
}

// --- House geometry -------------------------------------------------------
// All coordinates in METRES, plan-space. x = east, z = south. y = up.

/**
 * Firestore refuses to store an array directly inside another array, so plan
 * coordinates are objects rather than [x, z] tuples. Do not "simplify" this
 * back to tuples — the write silently fails with INVALID_ARGUMENT.
 */
export interface Pt { x: number; z: number }

export interface Wall {
  id: string
  a: Pt
  b: Pt
  height: number
  thickness: number
}

export interface Room {
  id: string
  name: string
  /** Closed polygon in plan metres. */
  polygon: Pt[]
  color?: string
}

export interface HousePlan {
  /** Storage path + download URL of the uploaded 2D floorplan image. */
  planImageUrl?: string | null
  /**
   * Inline backdrop as a data URL, for when Cloud Storage is not available.
   * Firestore caps a document at 1 MB, so keep this well under ~700 KB —
   * line art quantised to a small palette compresses to around 100 KB.
   */
  planImageData?: string | null
  /** Metres per image pixel, from the calibration step. */
  metresPerPixel?: number | null
  /** Image natural size in px, so the ground plane matches. */
  imageW?: number | null
  imageH?: number | null
  /** Plan image origin offset in metres. */
  originX?: number
  originZ?: number
  wallHeight: number
  walls: Wall[]
  rooms: Room[]
  updatedAt: string
}

// --- Shopping -------------------------------------------------------------

export interface ShoppingLine {
  itemId: string
  name: string
  qty: number
  unit: Unit
  store: StoreKey
  trip: TripKey
  /** Best known unit price, normalised to SGD. */
  estSgd: number | null
  reason: 'out' | 'low' | 'expiring' | 'manual'
  url?: string | null
  /** Cheaper elsewhere: set when we routed away from the default store. */
  savingNote?: string | null
  /** Every price we know for this item, so the message can show the compare. */
  alternatives?: { store: StoreKey; sgd: number }[]
  /** How much the chosen store beats the dearest known one, SGD. */
  saving?: number | null
}

// --- Settings -------------------------------------------------------------

export interface Settings {
  /** What the household calls the place, e.g. "Casaa". */
  householdName: string
  /**
   * Google display names are formal ("Caspar Ng Wei Ming"); people are not.
   * Maps a signed-in email to what the app should call that person.
   */
  nicknames: Record<string, string>
  /** MYR per 1 SGD. Used to compare JB prices. */
  myrPerSgd: number
  /** Don't send you to JB unless the basket is worth the causeway. */
  jbMinBasketSgd: number
  /** Days without being touched before long-term storage nags you. */
  storageNudgeDays: number
  /** Days of cover below which an item counts as low, on top of minQty. */
  lowCoverDays: number
  /** Warn this many days before expiry. */
  expiryWarnDays: number
  /** Ask to re-verify a count after this many days of silence. */
  staleVerifyDays: number
  weeklyDigestDay: number // 0=Sun .. 6=Sat
  telegramEnabled: boolean
  /** Skip the weekly digest unless at least this many things need buying. */
  minLinesForDigest: number
  /** Ping the same day when something runs out. */
  alertOnOut: boolean
  /** Hold back online orders when a Shopee sale is within this many days. */
  saleWaitDays: number
  updatedAt?: string
}

export const DEFAULT_SETTINGS: Settings = {
  householdName: 'Casaa',
  nicknames: {},
  myrPerSgd: 3.35,
  jbMinBasketSgd: 80,
  storageNudgeDays: 120,
  lowCoverDays: 10,
  expiryWarnDays: 14,
  staleVerifyDays: 45,
  weeklyDigestDay: 4, // Thursday — gives you the weekend to shop
  telegramEnabled: true,
  minLinesForDigest: 1,
  alertOnOut: true,
  saleWaitDays: 10,
}

export const DEFAULT_CATEGORIES = [
  'Pantry', 'Fridge', 'Freezer', 'Drinks', 'Snacks', 'Cleaning', 'Laundry',
  'Toiletries', 'Paper goods', 'Medicine', 'Pet', 'Baby', 'Tools', 'Electrical',
  'Stationery', 'Clothing', 'Bedding', 'Seasonal', 'Documents', 'Other',
]

export type StockStatus = 'out' | 'low' | 'expiring' | 'expired' | 'ok'
