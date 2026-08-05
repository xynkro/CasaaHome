import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useStore } from '../store'
import { DEFAULT_SETTINGS, type Settings } from '../types'
import { Field } from '../ui/primitives'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function SettingsView() {
  const settings = useStore(s => s.settings)
  const saveSettings = useStore(s => s.saveSettings)
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const user = useStore(s => s.user)
  const signOutNow = useStore(s => s.signOutNow)

  const [d, setD] = useState<Partial<Settings>>({})
  const v = <K extends keyof Settings>(k: K): Settings[K] =>
    (d[k] !== undefined ? d[k] : settings[k]) as Settings[K]
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setD(p => ({ ...p, [k]: val }))
  const dirty = Object.keys(d).length > 0

  const [access, setAccess] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [chatIds, setChatIds] = useState('')
  const [tgSaved, setTgSaved] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(doc(db, 'config', 'access'), s => {
      setAccess((s.data()?.emails as string[]) ?? [])
    }, () => {})
    const u2 = onSnapshot(doc(db, 'config', 'telegram'), s => {
      const d = s.data() ?? {}
      const list = [...(Array.isArray(d.chatIds) ? d.chatIds : []), ...(d.chatId ? [d.chatId] : [])]
      setChatIds([...new Set(list.map(String))].join(', '))
    }, () => {})
    return () => { u1(); u2() }
  }, [])

  const addEmail = async () => {
    const e = newEmail.trim().toLowerCase()
    if (!e || access.includes(e)) return
    await setDoc(doc(db, 'config', 'access'), { emails: [...access, e] }, { merge: true })
    setNewEmail('')
  }

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), settings, locations, items }, null, 2)],
      { type: 'application/json' },
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `casaahome-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <h1 className="text-xl font-semibold tracking-tight text-ink-200">Settings</h1>

      <Group title="This household">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Home is called" hint="shown on the dashboard">
            <input type="text" value={v('householdName') ?? ''} onChange={e => set('householdName', e.target.value)} />
          </Field>
          <Field label="Call me" hint={user?.email ?? ''}>
            <input
              type="text"
              value={v('nicknames')?.[user?.email ?? ''] ?? ''}
              placeholder={user?.displayName?.split(' ')[0] ?? 'your name'}
              onChange={e => set('nicknames', { ...(v('nicknames') ?? {}), [user?.email ?? '']: e.target.value })}
            />
          </Field>
        </div>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-ink-500">
          Everyone on the household list sets their own. Google display names are usually too formal to greet someone with.
        </p>
      </Group>

      <Group title="When to call something low">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Low at (days cover)" hint={`default ${DEFAULT_SETTINGS.lowCoverDays}`}>
            <input type="number" value={v('lowCoverDays')} onChange={e => set('lowCoverDays', Number(e.target.value))} />
          </Field>
          <Field label="Warn before expiry" hint="days">
            <input type="number" value={v('expiryWarnDays')} onChange={e => set('expiryWarnDays', Number(e.target.value))} />
          </Field>
        </div>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-ink-500">
          An item counts as low when it drops to its own minimum, <em>or</em> when the measured usage rate says
          there is under this many days of it left. The second rule only kicks in once there is enough history
          to estimate a rate.
        </p>
      </Group>

      <Group title="Verifying counts">
        <Field label="Ask me to re-check after" hint="days">
          <input type="number" value={v('staleVerifyDays')} onChange={e => set('staleVerifyDays', Number(e.target.value))} />
        </Field>
        <Field label="Nag about forgotten storage after" hint="days">
          <input type="number" value={v('storageNudgeDays')} onChange={e => set('storageNudgeDays', Number(e.target.value))} />
        </Field>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-ink-500">
          Only places marked <span className="text-ink-300">long-term storage</span> are nagged, and anything
          ticked <span className="text-ink-300">seasonal</span> is skipped entirely — winter clothes should not
          generate reminders.
        </p>
      </Group>

      <Group title="Singapore ↔ JB">
        <div className="grid grid-cols-2 gap-2">
          <Field label="MYR per SGD" hint="for price compare">
            <input type="number" step="0.01" value={v('myrPerSgd')} onChange={e => set('myrPerSgd', Number(e.target.value))} />
          </Field>
          <Field label="Min JB basket" hint="S$">
            <input type="number" value={v('jbMinBasketSgd')} onChange={e => set('jbMinBasketSgd', Number(e.target.value))} />
          </Field>
        </div>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-ink-500">
          Below the minimum basket, JB items get folded back into the Singapore list rather than sending you
          across for three bottles of detergent.
        </p>
      </Group>

      <Group title="Telegram">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Weekly digest day">
            <select value={v('weeklyDigestDay')} onChange={e => set('weeklyDigestDay', Number(e.target.value))}>
              {DAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}
            </select>
          </Field>
          <Field label="Send to" hint="chat IDs, comma separated">
            <input
              type="text"
              placeholder="-1001234567890, 922547929"
              value={chatIds}
              onChange={e => { setChatIds(e.target.value); setTgSaved(false) }}
              onBlur={async () => {
                const list = chatIds.split(',').map(s => s.trim()).filter(Boolean)
                // chatId is the older single-value form; clear it so the two
                // cannot drift apart and double-send.
                await setDoc(doc(db, 'config', 'telegram'), { chatIds: list, chatId: '' }, { merge: true })
                setTgSaved(true)
              }}
            />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Skip digest below" hint="items">
            <input type="number" value={v('minLinesForDigest')} onChange={e => set('minLinesForDigest', Number(e.target.value))} />
          </Field>
          <Field label="Wait for a sale up to" hint="days">
            <input type="number" value={v('saleWaitDays')} onChange={e => set('saleWaitDays', Number(e.target.value))} />
          </Field>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-300">
          <input type="checkbox" className="size-4 accent-[#E8A33D]"
            checked={v('telegramEnabled')} onChange={e => set('telegramEnabled', e.target.checked)} />
          Send the weekly digest
        </label>
        <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-ink-300">
          <input type="checkbox" className="size-4 accent-[#E8A33D]"
            checked={v('alertOnOut')} onChange={e => set('alertOnOut', e.target.checked)} />
          Ping the same day something runs out
        </label>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-ink-500">
          Shopee runs its campaigns on the double dates — 1.1, 2.2 … 12.12, open the day either
          side. Anything merely low is held back for the next one; anything you have actually run
          out of is bought now regardless.
        </p>
        {tgSaved && <p className="mt-1 text-[0.68rem] text-emerald-400">Saved.</p>}
        <p className="mt-2 text-[0.68rem] leading-relaxed text-ink-500">
          A group ID starts with a minus sign; a personal one does not. To add a group,
          invite the bot to it and send <code>/start@LVHome1646Bot</code> there — bots have
          privacy mode on by default and cannot see ordinary group chatter until addressed.
        </p>
      </Group>

      <Group title="Who can get in">
        <ul className="space-y-1 text-xs">
          {access.map(e => (
            <li key={e} className="flex items-center gap-2 rounded-lg bg-ink-850 px-2.5 py-1.5">
              <span className="flex-1 truncate text-ink-300">{e}</span>
              {e !== user?.email && (
                <button
                  className="text-ink-500 hover:text-rose-300"
                  onClick={() => setDoc(doc(db, 'config', 'access'), { emails: access.filter(x => x !== e) }, { merge: true })}
                >×</button>
              )}
            </li>
          ))}
          {access.length === 0 && <li className="text-ink-500">Could not read the allowlist.</li>}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            inputMode="email"
            placeholder="wife@gmail.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addEmail() } }}
          />
          <button className="btn btn-ghost shrink-0 text-xs" onClick={addEmail}>Add</button>
        </div>
        <p className="mt-1 text-[0.68rem] text-ink-500">
          Google accounts on this list can read and edit everything. Everyone else is refused by the database itself,
          not just the app.
        </p>
      </Group>

      <Group title="House">
        <Link to="/plan" className="btn btn-ghost w-full text-xs">Floorplan & 3D setup →</Link>
      </Group>

      <Group title="Data">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost text-xs" onClick={exportJson}>Export JSON backup</button>
          <button className="btn btn-ghost text-xs" onClick={signOutNow}>Sign out ({user?.email})</button>
        </div>
        <p className="mt-2 text-[0.68rem] text-ink-500">
          {items.length} items · {locations.length} places
        </p>
      </Group>

      {dirty && (
        <div
          className="sticky bottom-0 -mx-4 border-t border-ink-700 bg-ink-900/95 px-4 py-3 backdrop-blur"
          style={{ marginBottom: 'calc(-1.25rem)' }}
        >
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setD({})}>Discard</button>
            <button className="btn btn-primary flex-[2]" onClick={async () => { await saveSettings(d); setD({}) }}>
              Save settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel mt-4 px-3 py-3">
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-300">{title}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}
