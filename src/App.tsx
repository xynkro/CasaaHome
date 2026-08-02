import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from './store'
import Dashboard from './views/Dashboard'
import SearchView from './views/SearchView'
import LocationsView from './views/LocationsView'
import ShoppingView from './views/ShoppingView'
import SettingsView from './views/SettingsView'
import ItemSheet from './views/ItemSheet'
import { Empty } from './ui/primitives'

// Three.js is ~600 kB. Nobody should pay for it while checking if there is
// still coffee.
const HouseView = lazy(() => import('./views/HouseView'))
const PlanEditor = lazy(() => import('./views/PlanEditor'))

const TABS = [
  { to: '/', label: 'Home', icon: '◈' },
  { to: '/search', label: 'Search', icon: '⌕' },
  { to: '/house', label: 'House', icon: '⌂' },
  { to: '/places', label: 'Places', icon: '▤' },
  { to: '/shop', label: 'Shop', icon: '🛒' },
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

  useEffect(() => subscribe(), [subscribe])

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
          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
          <p className="mt-6 text-[0.65rem] text-ink-500">© {year} · household use only</p>
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
            hint={`${user.email} is signed in but is not allowed to read this home. Add the address to config/access in Firestore, then reload.`}
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
        style={{ paddingBottom: 'calc(4.5rem + var(--safe-b))' }}
      >
        <Routes>
          <Route path="/" element={<Dashboard onOpenItem={setOpenItem} />} />
          <Route path="/search" element={<SearchView onOpenItem={setOpenItem} />} />
          <Route path="/places" element={<LocationsView onOpenItem={setOpenItem} />} />
          <Route path="/shop" element={<ShoppingView onOpenItem={setOpenItem} />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route
            path="/house"
            element={
              <Suspense fallback={<Loading label="Building the house…" />}>
                <HouseView onOpenItem={setOpenItem} />
              </Suspense>
            }
          />
          <Route
            path="/plan"
            element={
              <Suspense fallback={<Loading label="Loading plan editor…" />}>
                <PlanEditor />
              </Suspense>
            }
          />
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
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[0.62rem] font-medium transition ${
                  isActive ? 'text-brass-400' : 'text-ink-400 hover:text-ink-300'
                }`
              }
            >
              <span className="text-base leading-none">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <ItemSheet itemId={openItem} onClose={() => setOpenItem(null)} />
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="grid h-[70dvh] place-items-center text-sm text-ink-400">
      <div className="flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-brass-400" />
        {label}
      </div>
    </div>
  )
}
