import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from './store'
import { indexedDbUsable } from './firebase'
import Dashboard from './views/Dashboard'
import SearchView from './views/SearchView'
import LocationsView from './views/LocationsView'
import ShoppingView from './views/ShoppingView'
import SettingsView from './views/SettingsView'
import ItemSheet from './views/ItemSheet'
import SnapPlace from './views/SnapPlace'
import CookView from './views/CookView'
import { Empty } from './ui/primitives'

/**
 * Drawn, not typed.
 *
 * The bar used to use text glyphs — ◈ ⌕ ⌂ ▤ 🛒 — and two of those are absent
 * from the system face, so Home and Search fell through to a hairline fallback
 * and looked ghosted beside their neighbours. The trolley was worse: a colour
 * emoji, so it ignored the active tint entirely and sat on its own baseline.
 * The row never read as one set. These share a 24 grid, one stroke weight, and
 * inherit currentColor like everything else.
 */
const Icon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7"
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const PATHS = {
  home:   'M3 10.4 12 3.5l9 6.9M5.4 9.2V19a1.4 1.4 0 0 0 1.4 1.4h10.4A1.4 1.4 0 0 0 18.6 19V9.2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16.2 16.2 21 21',
  places: 'M4 4.5h16v5H4zM4 14.5h16v5H4zM8 7h.01M8 17h.01',
  shop:   'M3 5h2.2l2.1 10.3a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6.2M9.5 20.2h.01M17 20.2h.01',
  camera: 'M3 8.6h3.3l1.5-2.1h8.4l1.5 2.1H21v10.9H3zM12 17.6a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
}

// Split so the shutter sits in the middle of the bar. Photographing a cupboard
// is the whole point of the app and it was reachable only through a text link
// in a section heading — Caspar looked for it and could not find it. The middle
// of the bar is the one place on a phone your thumb already is.
const LEFT_TABS = [
  { to: '/', label: 'Home', d: PATHS.home },
  { to: '/search', label: 'Search', d: PATHS.search },
]
const RIGHT_TABS = [
  { to: '/places', label: 'Places', d: PATHS.places },
  { to: '/shop', label: 'Shop', d: PATHS.shop },
]

function Tab({ to, label, d }: { to: string; label: string; d: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-micro font-medium transition ${
          isActive ? 'text-brass-400' : 'text-ink-400 hover:text-ink-300'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon d={d} filled={false} />
          <span className={isActive ? 'font-semibold' : undefined}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function App() {
  // Zustand v5 has no automatic shallow-compare: object selectors would
  // return a fresh object every render and loop forever. One field each.
  const subscribe = useStore(s => s.subscribe)
  const user = useStore(s => s.user)
  const authReady = useStore(s => s.authReady)
  const accessDenied = useStore(s => s.accessDenied)
  const signIn = useStore(s => s.signIn)
  const error = useStore(s => s.error)
  const location = useLocation()
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(false)

  useEffect(() => subscribe(), [subscribe])

  // Warn before the user clicks, rather than explaining a raw storage error
  // after the popup has already thrown.
  useEffect(() => { void indexedDbUsable().then(ok => setStorageBlocked(!ok)) }, [])

  // Deep link: #/item/<id> opens the detail sheet over whatever is behind it.
  useEffect(() => {
    const m = location.hash.match(/item=([^&]+)/)
    if (m) setOpenItem(decodeURIComponent(m[1]))
  }, [location.hash])

  const year = useMemo(() => new Date().getFullYear(), [])

  if (!authReady) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-400">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-brass-400" /> Starting…
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="panel w-full max-w-sm px-6 py-8 text-center rise">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brass-400/12 text-2xl">⌂</div>
          <h1 className="text-lg font-semibold text-ink-200">CasaaHome</h1>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Everything in the house, where it lives, and what is running out.
          </p>
          <button className="btn btn-primary mt-6 w-full" onClick={signIn}>
            Sign in with Google
          </button>
          {error && <p className="mt-3 text-left text-xs leading-relaxed text-rose-300">{error}</p>}
          {storageBlocked && !error && (
            <p className="mt-3 text-left text-xs leading-relaxed text-amber-300">
              This browser is blocking site storage, so the login may not stick.
              If sign-in fails, open the page in Safari or Chrome directly rather
              than inside another app.
            </p>
          )}
          <p className="mt-6 text-micro text-ink-500">© {year} · household use only</p>
        </div>
      </div>
    )
  }

  if (accessDenied) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="w-full max-w-sm">
          <Empty
            icon="⛔"
            title="Not on the household list"
            hint={`${user.email} is signed in, but that address is not on the household list. Ask whoever set this up to add it under Settings → Who can get in, then reload. If that is you, sign in with the account you used first.`}
            action={<button className="btn btn-ghost" onClick={() => useStore.getState().signOutNow()}>Sign out</button>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <main
        className="scroll-thin min-h-0 flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(var(--nav-h) + var(--safe-b) + 0.5rem)' }}
      >
        <Routes>
          <Route path="/" element={<Dashboard onOpenItem={setOpenItem} />} />
          <Route path="/search" element={<SearchView onOpenItem={setOpenItem} />} />
          <Route path="/places" element={<LocationsView onOpenItem={setOpenItem} />} />
          <Route path="/shop" element={<ShoppingView onOpenItem={setOpenItem} />} />
          <Route path="/cook" element={<CookView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-900/92 backdrop-blur-lg"
        style={{ paddingBottom: 'var(--safe-b)' }}
      >
        <div className="mx-auto flex max-w-2xl items-center">
          {LEFT_TABS.map(t => <Tab key={t.to} {...t} />)}

          <button
            onClick={() => setSnapping(true)}
            aria-label="Photograph a cupboard"
            className="flex min-h-11 w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 py-1.5"
          >
            <span className="grid size-12 -translate-y-3 place-items-center rounded-full bg-brass-400 text-ink-950 shadow-[0_4px_14px_rgba(11,107,94,0.4)] transition active:scale-95">
              <Icon d={PATHS.camera} filled={false} />
            </span>
            <span className="-mt-2.5 text-micro font-semibold text-brass-400">Snap</span>
          </button>

          {RIGHT_TABS.map(t => <Tab key={t.to} {...t} />)}
        </div>
      </nav>

      <ItemSheet itemId={openItem} onClose={() => setOpenItem(null)} />
      <SnapPlace open={snapping} onClose={() => setSnapping(false)} />
    </div>
  )
}
