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
}

const TABS = [
  { to: '/', label: 'Home', d: PATHS.home },
  { to: '/search', label: 'Search', d: PATHS.search },
  { to: '/places', label: 'Places', d: PATHS.places },
  { to: '/shop', label: 'Shop', d: PATHS.shop },
]

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
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-900/92 backdrop-blur-lg"
        style={{ paddingBottom: 'var(--safe-b)' }}
      >
        <div className="mx-auto flex max-w-2xl">
          {TABS.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-micro font-medium transition ${
                  isActive ? 'text-brass-400' : 'text-ink-400 hover:text-ink-300'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon d={t.d} filled={false} />
                  <span className={isActive ? 'font-semibold' : undefined}>{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <ItemSheet itemId={openItem} onClose={() => setOpenItem(null)} />
    </div>
  )
}
