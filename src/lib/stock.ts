import type { Item, Settings, StockEvent, StockStatus } from '../types'

export const DAY_MS = 86_400_000

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const t1 = typeof a === 'string' ? Date.parse(a) : a.getTime()
  const t2 = typeof b === 'string' ? Date.parse(b) : b.getTime()
  return (t2 - t1) / DAY_MS
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (t - Date.now()) / DAY_MS
}

/**
 * Estimate consumption rate from the event log.
 *
 * The core insight: we do NOT trust people to log every use. What we DO get
 * are honest reconciliations ("app said 10, there are actually 2"). So burn
 * rate is derived from total observed *decrease* across the whole observed
 * window, ignoring restocks — a reconcile that finds less than expected is
 * consumption we simply hadn't been told about yet.
 */
export function estimateBurnPerDay(events: StockEvent[]): number | null {
  const log = [...events]
    .filter(e => e.type !== 'create' && e.type !== 'move')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  if (log.length < 2) return null

  const spanDays = daysBetween(log[0].at, log[log.length - 1].at)
  if (spanDays < 3) return null

  let consumed = 0
  for (const e of log) {
    // Restocks are additions, not consumption. A reconcile that went UP is
    // either an unlogged purchase or a miscount — either way, not burn.
    if (e.type === 'restock') continue
    if (e.delta < 0) consumed += -e.delta
  }
  if (consumed <= 0) return null

  const rate = consumed / spanDays
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

/** Days of stock left at the current burn rate. */
export function daysOfCover(item: Item): number | null {
  const burn = item.burnPerDay
  if (!burn || burn <= 0) return null
  return item.qty / burn
}

export function stockStatus(item: Item, s: Settings): StockStatus {
  const untilExpiry = daysUntil(item.expiryDate)
  if (untilExpiry !== null && untilExpiry < 0 && item.qty > 0) return 'expired'
  if (item.qty <= 0) return 'out'
  if (untilExpiry !== null && untilExpiry <= s.expiryWarnDays) return 'expiring'
  if (item.qty <= item.minQty) return 'low'
  const cover = daysOfCover(item)
  if (cover !== null && cover <= s.lowCoverDays) return 'low'
  return 'ok'
}

export const STATUS_ORDER: Record<StockStatus, number> = {
  out: 0, expired: 1, expiring: 2, low: 3, ok: 4,
}

/**
 * The marking pigments — earth and glaze, not signal colours. Nothing in this
 * app glows.
 *
 * `hex` is read by the Telegram notifier and by the 3D markers, so it must
 * agree with `cls`: the UI and the model should never disagree about what
 * "low" looks like.
 */
export const STATUS_META: Record<StockStatus, { label: string; cls: string; dot: string; hex: string }> = {
  out:      { label: 'Out',      cls: 'text-mark-red bg-mark-red/8 border-mark-red/30',       dot: 'bg-mark-red',   hex: '#9B2C3A' },
  expired:  { label: 'Expired',  cls: 'text-mark-red bg-mark-red/8 border-mark-red/30',       dot: 'bg-mark-red',   hex: '#9B2C3A' },
  expiring: { label: 'Expiring', cls: 'text-mark-rust bg-mark-rust/8 border-mark-rust/30',    dot: 'bg-mark-rust',  hex: '#96430F' },
  low:      { label: 'Low',      cls: 'text-mark-ochre bg-mark-ochre/8 border-mark-ochre/30', dot: 'bg-mark-ochre', hex: '#8A5510' },
  ok:       { label: 'OK',       cls: 'text-ink-500 bg-ink-800 border-ink-600',               dot: 'bg-mark-leaf',  hex: '#1C6B45' },
}

/** How many to buy to get back to par. */
export function restockQty(item: Item): number {
  const target = Math.max(item.parLevel, item.minQty + 1)
  const need = target - item.qty
  return need > 0 ? Math.ceil(need) : 0
}

/** True if nobody has physically confirmed this count in a long time. */
export function isStale(item: Item, s: Settings): boolean {
  if (!item.lastVerifiedAt) return true
  return daysBetween(item.lastVerifiedAt) > s.staleVerifyDays
}

/**
 * Long-term storage nudge: things you squirrelled away and forgot.
 * Seasonal items (winter clothes, Christmas decor) are explicitly exempt —
 * being untouched for a year is correct behaviour for those.
 */
export function needsUseNudge(item: Item, longTermLocation: boolean, s: Settings): boolean {
  if (!longTermLocation) return false
  if (item.seasonal) return false
  if (item.qty <= 0) return false
  const since = item.lastVerifiedAt ?? item.updatedAt ?? item.createdAt
  return daysBetween(since) > s.storageNudgeDays
}

export function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? String(qty) : qty.toFixed(1)
  return `${n} ${unit}`
}

export function fmtCover(item: Item): string | null {
  const cover = daysOfCover(item)
  if (cover === null) return null
  if (cover < 1) return 'under a day left'
  if (cover < 14) return `~${Math.round(cover)}d left`
  if (cover < 70) return `~${Math.round(cover / 7)}w left`
  return `~${Math.round(cover / 30)}mo left`
}
