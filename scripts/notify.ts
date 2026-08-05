/**
 * CasaaHome Telegram notifier.
 *
 * Runs on a GitHub Actions cron (hourly) rather than Cloud Functions: it is
 * free, it is always awake regardless of whether the Mac is, and it keeps the
 * whole system inside the one repo. It decides for itself what — if anything —
 * is worth sending on this pass.
 *
 *   pending outbox request  → send the shopping list immediately
 *   urgent (once per day)   → anything that has newly run OUT
 *   weekly digest           → full split list on the configured day
 */

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  DEFAULT_SETTINGS,
  type Item, type Settings, type StorageLocation, type TripKey,
} from '../src/types'
import { buildShoppingPlan, buildUseSoon } from '../src/lib/shopping'
import { shopeeSearch } from '../src/lib/links'
import { stockStatus } from '../src/lib/stock'

const TZ = 'Asia/Singapore'
const APP_URL = process.env.APP_URL || 'https://xynkro.github.io/CasaaHome/'
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const DRY = process.env.DRY_RUN === 'true'

const svc = process.env.FIREBASE_SERVICE_ACCOUNT
if (!svc) {
  // Not an error: the cron starts running the moment the repo exists, which
  // is before anyone has had a chance to add the secrets. Exiting green keeps
  // the Actions tab honest — a red run should mean something is broken.
  console.log(
    'FIREBASE_SERVICE_ACCOUNT is not set — Telegram is not configured yet.\n' +
    'See README step 4. Nothing to do.',
  )
  process.exit(0)
}
if (!TOKEN && !DRY) {
  console.log('TELEGRAM_BOT_TOKEN is not set — Telegram is not configured yet. Nothing to do.')
  process.exit(0)
}
initializeApp({ credential: cert(JSON.parse(svc)) })
const db = getFirestore()

// --- helpers ---------------------------------------------------------------

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function sgNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return {
    dayOfWeek: dayIdx,
    hour: Number(get('hour')),
    label: `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} SGT`,
    dateKey: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()),
  }
}

async function send(chatId: string, html: string) {
  if (DRY) {
    console.log('--- would send ---\n' + html.replace(/<[^>]+>/g, '') + '\n')
    return
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html.slice(0, 4000),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`)
  // Telegram rate-limits bursts; a beat between messages keeps ordering sane.
  await new Promise(r => setTimeout(r, 400))
}

// --- data ------------------------------------------------------------------

async function load() {
  const [itemsSnap, locSnap, settingsSnap, tgSnap, stateSnap, outboxSnap] = await Promise.all([
    db.collection('items').get(),
    db.collection('locations').get(),
    db.doc('config/settings').get(),
    db.doc('config/telegram').get(),
    db.doc('telegram/state').get(),
    db.doc('telegram/outbox').get(),
  ])

  const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Item).filter(i => !i.archived)
  const locations = locSnap.docs.map(d => ({ id: d.id, ...d.data() }) as StorageLocation)
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(settingsSnap.data() as Settings | undefined) }
  // One or many destinations. A household group is the usual case; DMs and a
  // group can coexist. `chatId` is the older single-value form, kept working.
  const tg = tgSnap.data() ?? {}
  const chatIds: string[] = [
    ...(Array.isArray(tg.chatIds) ? tg.chatIds : []),
    ...(tg.chatId ? [tg.chatId] : []),
  ].map(String).map(s => s.trim()).filter(Boolean)
  const uniqueChats = [...new Set(chatIds)]
  const state = (stateSnap.data() ?? {}) as {
    lastWeeklyDate?: string
    lastUrgentDate?: string
    notifiedOut?: Record<string, string>
  }
  const outbox = outboxSnap.exists ? (outboxSnap.data() as { status?: string }) : null

  return { items, locations, settings, chatIds: uniqueChats, state, outbox }
}

// --- message builders ------------------------------------------------------

const TRIP: Record<TripKey, { head: string; note: string }> = {
  sg: { head: '🛒 <b>Singapore run</b>', note: 'FairPrice / nearby' },
  jb: { head: '🚗 <b>JB run</b>', note: 'Giant · AEON — bring the boot' },
  online: { head: '📦 <b>Order online</b>', note: 'Shopee' },
}

function tripMessage(trip: TripKey, plan: ReturnType<typeof buildShoppingPlan>, items: Item[]) {
  const lines = plan.byTrip[trip]
  if (!lines.length) return null

  const out = [TRIP[trip].head, `<i>${TRIP[trip].note}</i>`, '']
  for (const l of lines) {
    const item = items.find(i => i.id === l.itemId)
    const price = l.estSgd ? ` — ~S$${l.estSgd.toFixed(2)}` : ''
    const flag = l.reason === 'out' ? ' ⚠️' : ''
    const name = esc(l.name)
    const label = trip === 'online' && item
      ? `<a href="${esc(shopeeSearch(item))}">${name}</a>`
      : name
    out.push(`• ${label} × ${l.qty} ${esc(l.unit)}${price}${flag}`)
    if (l.savingNote) out.push(`   <i>${esc(l.savingNote)}</i>`)
  }
  const total = plan.totals[trip]
  if (total > 0) out.push('', `<b>~S$${total.toFixed(2)}</b>`)
  return out.join('\n')
}

function useSoonMessage(entries: ReturnType<typeof buildUseSoon>) {
  if (!entries.length) return null
  const expiring = entries.filter(e => e.reason !== 'forgotten')
  const forgotten = entries.filter(e => e.reason === 'forgotten')
  const out: string[] = ['🍽 <b>Use these up</b>', '']

  if (expiring.length) {
    for (const e of expiring.slice(0, 20)) {
      const icon = e.reason === 'expired' ? '❌' : '⏳'
      out.push(`${icon} ${esc(e.item.name)} — ${esc(e.detail)}`)
      out.push(`   <i>${esc(e.locationName)}</i>`)
    }
  }

  if (forgotten.length) {
    out.push('', '📦 <b>Forgotten in storage</b>')
    out.push('<i>Sitting untouched. Seasonal things are excluded.</i>', '')
    for (const e of forgotten.slice(0, 15)) {
      out.push(`• ${esc(e.item.name)} — <i>${esc(e.locationName)}</i>`)
    }
  }
  return out.join('\n')
}

// --- main ------------------------------------------------------------------

async function main() {
  const { items, locations, settings, chatIds, state, outbox } = await load()
  if (!chatIds.length && !DRY) {
    console.log('No chat ID configured yet — set it in the app under Settings › Telegram. Nothing sent.')
    return
  }
  const targets = chatIds.length ? chatIds : ['dry-run']
  const fanout = async (html: string) => { for (const id of targets) await send(id, html) }

  const now = sgNow()
  const locMap = new Map(locations.map(l => [l.id, l]))
  const plan = buildShoppingPlan(items, settings)
  const useSoon = buildUseSoon(items, locMap, settings)

  const manualRequest = outbox?.status === 'pending'
  const isDigestDay = settings.telegramEnabled
    && now.dayOfWeek === settings.weeklyDigestDay
    && now.hour >= 8
    && state.lastWeeklyDate !== now.dateKey

  // Anything that crossed into "out" since we last looked.
  const outNow = items.filter(i => stockStatus(i, settings) === 'out')
  const alreadyTold = state.notifiedOut ?? {}
  const newlyOut = outNow.filter(i => !alreadyTold[i.id])
  const isUrgent = settings.telegramEnabled
    && newlyOut.length > 0
    && now.hour >= 8 && now.hour <= 21
    && state.lastUrgentDate !== now.dateKey

  const sent: string[] = []

  if (isDigestDay || manualRequest) {
    const header = [
      `🏠 <b>${esc(settings.householdName || 'Home')} — weekly list</b>`,
      `<i>${now.label}</i>`,
      '',
      plan.lines.length
        ? `${plan.lines.length} ${plan.lines.length === 1 ? 'thing' : 'things'} to restock.`
        : 'Nothing needs restocking.',
      !plan.jbWorthIt && plan.jbFolded.length
        ? `\n<i>JB skipped — basket under S$${settings.jbMinBasketSgd}, folded into the SG list.</i>`
        : '',
      `\n<a href="${APP_URL}">Open CasaaHome</a>`,
    ].filter(Boolean).join('\n')

    await fanout(header)
    for (const trip of ['sg', 'jb', 'online'] as TripKey[]) {
      const msg = tripMessage(trip, plan, items)
      if (msg) await fanout(msg)
    }
    const use = useSoonMessage(useSoon)
    if (use) await fanout(use)

    sent.push(manualRequest ? 'manual' : 'weekly')
  } else if (isUrgent) {
    const lines = newlyOut.slice(0, 15).map(i => {
      const loc = i.locationId ? locMap.get(i.locationId)?.name : null
      return `• ${esc(i.name)}${loc ? ` — <i>${esc(loc)}</i>` : ''}`
    })
    await fanout([
      '⚠️ <b>Just ran out</b>',
      `<i>${now.label}</i>`,
      '',
      ...lines,
      '',
      `<a href="${APP_URL}#/shop">See the shopping list</a>`,
    ].join('\n'))
    sent.push('urgent')
  }

  // Persist what we told them, so nothing gets repeated tomorrow and items
  // that were restocked can go quiet again.
  const notifiedOut: Record<string, string> = {}
  for (const i of outNow) notifiedOut[i.id] = alreadyTold[i.id] ?? new Date().toISOString()

  await db.doc('telegram/state').set({
    notifiedOut,
    lastWeeklyDate: (isDigestDay || manualRequest) ? now.dateKey : state.lastWeeklyDate ?? null,
    lastUrgentDate: isUrgent ? now.dateKey : state.lastUrgentDate ?? null,
    lastRunAt: new Date().toISOString(),
  }, { merge: true })

  if (manualRequest) {
    await db.doc('telegram/outbox').set({ status: 'sent', sentAt: new Date().toISOString() }, { merge: true })
  }

  console.log(sent.length ? `Sent: ${sent.join(', ')}` : `Nothing to send (${now.label}).`)
}

main().catch(e => { console.error(e); process.exit(1) })
