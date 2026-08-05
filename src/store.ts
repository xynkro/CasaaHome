import { create } from 'zustand'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy, limit, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, type User,
} from 'firebase/auth'
import { auth, db, googleProvider } from './firebase'
import {
  DEFAULT_SETTINGS,
  type HousePlan, type Item, type Settings, type StockEvent, type StockEventType,
  type StorageLocation,
} from './types'
import { estimateBurnPerDay } from './lib/stock'

const nowIso = () => new Date().toISOString()
const HISTORY_CAP = 40

export interface ShoppingState {
  checked: Record<string, boolean>
  manual: { itemId: string; qty: number }[]
  updatedAt?: string
}

interface Store {
  // auth
  user: User | null
  authReady: boolean
  accessDenied: boolean
  signIn: () => Promise<void>
  signOutNow: () => Promise<void>

  // data
  items: Item[]
  locations: StorageLocation[]
  plan: HousePlan
  settings: Settings
  shopping: ShoppingState
  events: StockEvent[]
  loaded: boolean
  error: string | null

  subscribe: () => () => void

  // mutations
  saveItem: (patch: Partial<Item> & { id?: string }) => Promise<string>
  deleteItem: (id: string) => Promise<void>
  /** The headline interaction: "there are actually N left". */
  setQty: (id: string, actual: number, type?: StockEventType, note?: string) => Promise<void>
  verifyItem: (id: string) => Promise<void>

  saveLocation: (patch: Partial<StorageLocation> & { id?: string }) => Promise<string>
  deleteLocation: (id: string) => Promise<void>

  savePlan: (patch: Partial<HousePlan>) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  saveShopping: (patch: Partial<ShoppingState>) => Promise<void>
}

export const EMPTY_PLAN: HousePlan = {
  planImageUrl: null,
  metresPerPixel: null,
  imageW: null,
  imageH: null,
  originX: 0,
  originZ: 0,
  wallHeight: 2.8,
  walls: [],
  rooms: [],
  updatedAt: nowIso(),
}

export const useStore = create<Store>((set, get) => ({
  user: null,
  authReady: false,
  accessDenied: false,
  items: [],
  locations: [],
  plan: EMPTY_PLAN,
  settings: DEFAULT_SETTINGS,
  shopping: { checked: {}, manual: [] },
  events: [],
  loaded: false,
  error: null,

  signIn: async () => {
    set({ error: null, accessDenied: false })
    try {
      await signInWithPopup(auth, googleProvider)
      return
    } catch (e) {
      if (isUserCancelled(e)) return
      if (!worthRetryingByRedirect(e)) { set({ error: explain(e) }); return }
      // Popups are blocked or the storage the popup flow needs is unavailable
      // (private window, in-app browser). A full-page redirect needs neither.
      try {
        await signInWithRedirect(auth, googleProvider)
      } catch (e2) {
        set({ error: explain(e2) })
      }
    }
  },

  signOutNow: async () => {
    await signOut(auth)
    set({ items: [], locations: [], loaded: false, accessDenied: false })
  },

  subscribe: () => {
    let dataUnsubs: (() => void)[] = []

    const stopData = () => {
      dataUnsubs.forEach(u => u())
      dataUnsubs = []
    }

    const startData = () => {
      stopData()
      const fail = (e: unknown) => {
        const msg = (e as Error).message ?? String(e)
        // Rules reject anyone not on the allowlist — surface that as a clear
        // "ask the household owner to add you" rather than a raw error.
        if (/permission|insufficient/i.test(msg)) set({ accessDenied: true, loaded: true })
        else set({ error: msg, loaded: true })
      }

      dataUnsubs.push(onSnapshot(collection(db, 'items'), snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as Item))
        set({ items, loaded: true, accessDenied: false })
      }, fail))

      dataUnsubs.push(onSnapshot(collection(db, 'locations'), snap => {
        set({ locations: snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as StorageLocation)) })
      }, fail))

      dataUnsubs.push(onSnapshot(doc(db, 'house', 'plan'), snap => {
        set({ plan: snap.exists() ? { ...EMPTY_PLAN, ...(snap.data() as HousePlan) } : EMPTY_PLAN })
      }, fail))

      dataUnsubs.push(onSnapshot(doc(db, 'config', 'settings'), snap => {
        set({ settings: snap.exists() ? { ...DEFAULT_SETTINGS, ...(snap.data() as Settings) } : DEFAULT_SETTINGS })
      }, fail))

      dataUnsubs.push(onSnapshot(doc(db, 'shopping', 'state'), snap => {
        set({ shopping: snap.exists() ? normaliseShopping(snap.data() as ShoppingState) : { checked: {}, manual: [] } })
      }, fail))

      dataUnsubs.push(onSnapshot(
        query(collection(db, 'events'), orderBy('at', 'desc'), limit(120)),
        snap => set({ events: snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as StockEvent)) }),
        () => { /* activity feed is non-critical */ },
      ))
    }

    // If signIn fell back to a full-page redirect, the answer is waiting here
    // when we come back. Failures are reported, not swallowed — otherwise a
    // redirect that bounced looks identical to never having tried.
    getRedirectResult(auth).catch(e => {
      if (!isUserCancelled(e)) set({ error: explain(e) })
    })

    const unsubAuth = onAuthStateChanged(auth, u => {
      set({ user: u, authReady: true })
      if (u) startData()
      else { stopData(); set({ loaded: false }) }
    })

    return () => { unsubAuth(); stopData() }
  },

  saveItem: async patch => {
    const by = get().user?.email ?? 'unknown'
    const ts = nowIso()
    if (patch.id) {
      const { id, ...rest } = patch
      await updateDoc(doc(db, 'items', id), { ...rest, updatedAt: ts })
      return id
    }
    const base: Omit<Item, 'id'> = {
      name: patch.name ?? 'Untitled',
      brand: patch.brand ?? '',
      category: patch.category ?? 'Other',
      tags: patch.tags ?? [],
      locationId: patch.locationId ?? null,
      qty: patch.qty ?? 1,
      unit: patch.unit ?? 'pcs',
      parLevel: patch.parLevel ?? Math.max(patch.qty ?? 1, 1),
      minQty: patch.minQty ?? 1,
      perishable: patch.perishable ?? false,
      expiryDate: patch.expiryDate ?? null,
      openedAt: patch.openedAt ?? null,
      photoUrls: patch.photoUrls ?? [],
      notes: patch.notes ?? '',
      barcode: patch.barcode ?? null,
      seasonal: patch.seasonal ?? false,
      storeHint: patch.storeHint ?? null,
      shopeeUrl: patch.shopeeUrl ?? null,
      priceRefs: patch.priceRefs ?? [],
      lastVerifiedAt: ts,
      burnPerDay: null,
      archived: false,
      createdAt: ts,
      updatedAt: ts,
    }
    const created = await addDoc(collection(db, 'items'), { ...base, history: [] })
    void logEvent(created.id, 'create', 0, base.qty, by)
    return created.id
  },

  deleteItem: async id => { await deleteDoc(doc(db, 'items', id)) },

  setQty: async (id, actual, type, note) => {
    const item = get().items.find(i => i.id === id)
    if (!item) return
    const by = get().user?.email ?? 'unknown'
    const before = item.qty
    const after = Math.max(0, actual)
    if (before === after && type !== 'restock') {
      // Still a useful signal: someone looked and confirmed.
      await updateDoc(doc(db, 'items', id), { lastVerifiedAt: nowIso() })
      return
    }

    const kind: StockEventType = type ?? (after > before ? 'restock' : 'reconcile')
    const ev: StockEvent = {
      id: crypto.randomUUID(),
      itemId: id,
      type: kind,
      qtyBefore: before,
      qtyAfter: after,
      delta: after - before,
      at: nowIso(),
      by,
      note,
    }

    const history = [...((item as Item & { history?: StockEvent[] }).history ?? []), ev].slice(-HISTORY_CAP)
    const burnPerDay = estimateBurnPerDay(history)

    await updateDoc(doc(db, 'items', id), {
      qty: after,
      history,
      burnPerDay: burnPerDay ?? null,
      lastVerifiedAt: ev.at,
      updatedAt: ev.at,
    })
    void logEvent(id, kind, before, after, by, note)
  },

  verifyItem: async id => {
    await updateDoc(doc(db, 'items', id), { lastVerifiedAt: nowIso() })
  },

  saveLocation: async patch => {
    const ts = nowIso()
    if (patch.id) {
      const { id, ...rest } = patch
      await updateDoc(doc(db, 'locations', id), { ...rest, updatedAt: ts })
      return id
    }
    const created = await addDoc(collection(db, 'locations'), {
      name: patch.name ?? 'New place',
      kind: patch.kind ?? 'cabinet',
      roomId: patch.roomId ?? null,
      parentId: patch.parentId ?? null,
      pos: patch.pos ?? null,
      photoUrls: patch.photoUrls ?? [],
      notes: patch.notes ?? '',
      longTerm: patch.longTerm ?? false,
      createdAt: ts,
      updatedAt: ts,
    })
    return created.id
  },

  deleteLocation: async id => {
    // Never orphan items: unfile them in the same batch as the delete.
    const affected = get().items.filter(i => i.locationId === id)
    const batch = writeBatch(db)
    batch.delete(doc(db, 'locations', id))
    for (const i of affected) batch.update(doc(db, 'items', i.id), { locationId: null })
    for (const child of get().locations.filter(l => l.parentId === id)) {
      batch.update(doc(db, 'locations', child.id), { parentId: null })
    }
    await batch.commit()
  },

  savePlan: async patch => {
    await setDoc(doc(db, 'house', 'plan'), { ...patch, updatedAt: nowIso() }, { merge: true })
  },

  saveSettings: async patch => {
    await setDoc(doc(db, 'config', 'settings'), { ...patch, updatedAt: nowIso() }, { merge: true })
  },

  saveShopping: async patch => {
    await setDoc(doc(db, 'shopping', 'state'), { ...patch, updatedAt: nowIso() }, { merge: true })
  },
}))

function normaliseShopping(d: Partial<ShoppingState>): ShoppingState {
  return { checked: d.checked ?? {}, manual: d.manual ?? [], updatedAt: d.updatedAt }
}

// --- sign-in error handling ------------------------------------------------

const codeOf = (e: unknown) => String((e as { code?: string })?.code ?? '')
const msgOf = (e: unknown) => String((e as { message?: string })?.message ?? e ?? '')

/** Closing the Google popup is not an error worth showing. */
function isUserCancelled(e: unknown): boolean {
  return /popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(codeOf(e))
}

/**
 * Popup sign-in fails for two broad reasons: the popup itself was refused, or
 * the browser storage the popup flow depends on is unavailable. A full-page
 * redirect needs neither, so it is worth one automatic attempt. Anything else
 * — wrong domain, network down, provider disabled — would fail identically.
 */
function worthRetryingByRedirect(e: unknown): boolean {
  const s = `${codeOf(e)} ${msgOf(e)}`.toLowerCase()
  if (/unauthorized-domain|network-request-failed|operation-not-allowed/.test(s)) return false
  return /popup|storage|indexeddb|database|not-supported|unsupported/.test(s)
}

function explain(e: unknown): string {
  const code = codeOf(e)
  const s = `${code} ${msgOf(e)}`.toLowerCase()

  if (code === 'auth/unauthorized-domain') {
    return `${location.hostname} is not an authorised domain for this Firebase project. Add it under Authentication → Settings → Authorised domains.`
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in is not enabled on this Firebase project yet.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Could not reach Google. Check the connection and try again.'
  }
  if (/storage|indexeddb|database|web-storage/.test(s)) {
    return 'This browser is not letting the app store a login. That usually means a private window or an in-app browser — open the link in Safari or Chrome directly and it will work.'
  }
  if (/popup/.test(s)) {
    return 'The sign-in window was blocked. Allow popups for this site, or try again — it will use a full-page redirect instead.'
  }
  return msgOf(e) || 'Sign-in failed.'
}

async function logEvent(
  itemId: string, type: StockEventType, qtyBefore: number, qtyAfter: number,
  by: string, note?: string,
) {
  try {
    await addDoc(collection(db, 'events'), {
      itemId, type, qtyBefore, qtyAfter,
      delta: qtyAfter - qtyBefore,
      at: nowIso(),
      by,
      note: note ?? '',
      _ts: serverTimestamp(),
    })
  } catch {
    // The audit feed is a nice-to-have; never let it block a stock update.
  }
}

// --- selectors -------------------------------------------------------------

export function useLocationMap() {
  const locations = useStore(s => s.locations)
  return new Map(locations.map(l => [l.id, l]))
}

/** Full breadcrumb for a nested location: "Kitchen ▸ Tall cabinet ▸ Shelf 2". */
export function locationPath(
  id: string | null | undefined,
  map: Map<string, StorageLocation>,
  plan: HousePlan,
): string {
  if (!id) return 'Unfiled'
  const chain: string[] = []
  let cur = map.get(id)
  let guard = 0
  while (cur && guard++ < 10) {
    chain.unshift(cur.name)
    cur = cur.parentId ? map.get(cur.parentId) : undefined
  }
  const first = map.get(id)
  const room = first?.roomId ? plan.rooms.find(r => r.id === first.roomId) : null
  if (room) chain.unshift(room.name)
  return chain.join(' ▸ ') || 'Unfiled'
}
