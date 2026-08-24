import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { RECIPES, CUISINES, buildPantry, matchAll, type Match, type Ingredient, type Cuisine } from '../lib/recipes'
import { Sheet, Empty } from '../ui/primitives'

/**
 * What can we cook tonight?
 *
 * The ranking does the arguing: cookable first, then whatever you are closest
 * to. That second group is the point. This house tracks staples rather than
 * every ingredient, so "you can cook nothing" would be the honest answer most
 * evenings and a useless one — "you are one egg from fried rice" is the same
 * fact facing the other way, and it can be acted on.
 */
type Filter = 'all' | 'now' | 'close' | 'quick' | 'veg'

export default function CookView() {
  const items = useStore(s => s.items)
  const locations = useStore(s => s.locations)
  const saveItem = useStore(s => s.saveItem)
  const loaded = useStore(s => s.loaded)
  const locationsLoaded = useStore(s => s.locationsLoaded)
  const [filter, setFilter] = useState<Filter>('all')
  const [cuisine, setCuisine] = useState<Cuisine | null>(null)
  const [open, setOpen] = useState<Match | null>(null)

  const pantry = useMemo(
    () => buildPantry(items, locations.map(l => l.contents)),
    [items, locations],
  )
  const matches = useMemo(() => matchAll(RECIPES, pantry), [pantry])

  // Everything on this screen is a claim about what the house has. Rendering
  // that claim against a store that has not finished loading says "you are
  // short of everything", confidently, a moment before saying something else.
  const ready = loaded && locationsLoaded

  const cookable = matches.filter(m => m.canCook)
  const close = matches.filter(m => !m.canCook && m.missing.length <= 2)

  const shown = useMemo(() => {
    const base = cuisine ? matches.filter(m => m.recipe.cuisine === cuisine) : matches
    switch (filter) {
      case 'now': return base.filter(m => m.canCook)
      case 'close': return base.filter(m => !m.canCook && m.missing.length <= 2)
      case 'quick': return base.filter(m => m.recipe.minutes <= 15)
      case 'veg': return base.filter(m => m.recipe.tags.includes('vegetarian'))
      default: return base
    }
  }, [filter, cuisine, matches])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="rise">
        <div className="text-mini font-medium text-brass-400">Kitchen</div>
        <h1 className="mt-0.5 text-[28px] font-semibold tracking-[-0.011em] text-ink-200">
          What can we cook?
        </h1>
        <p className="mt-1 text-mini leading-relaxed text-ink-400">
          Worked out from what is in the cupboards and the fridge right now.
          Salt, oil and sugar are assumed unless you have said otherwise.
        </p>
      </header>

      {!ready ? (
        <div className="mt-6 grid place-items-center py-12 text-sm text-ink-400">
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-brass-400" />
            Checking the cupboards…
          </div>
        </div>
      ) : (
      <>
      <div className="panel mt-4 flex overflow-hidden">
        <Tally value={cookable.length} label="Ready now" tone={cookable.length ? 'good' : 'flat'} />
        <Tally value={close.length} label="Nearly" tone={close.length ? 'warn' : 'flat'} />
        <Tally value={RECIPES.length} label="Recipes" tone="flat" />
      </div>

      {/* Cuisine first — it is how anyone actually decides what to eat. */}
      <div className="scroll-thin mt-3 flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setCuisine(null)}
          className={`chip shrink-0 ${cuisine === null
            ? 'border-brass-500/50 bg-brass-400/12 text-brass-300'
            : 'border-ink-600 bg-ink-800 text-ink-400'}`}
        >All cuisines</button>
        {CUISINES.map(c => {
          const n = matches.filter(m => m.recipe.cuisine === c && m.canCook).length
          return (
            <button
              key={c}
              onClick={() => setCuisine(cuisine === c ? null : c)}
              className={`chip shrink-0 ${cuisine === c
                ? 'border-brass-500/50 bg-brass-400/12 text-brass-300'
                : 'border-ink-600 bg-ink-800 text-ink-400'}`}
            >{c}{n > 0 && <span className="tnum ml-1 text-mark-leaf">{n}</span>}</button>
          )
        })}
      </div>

      <div className="scroll-thin mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
        {([['all', 'Everything'], ['now', 'Ready now'], ['close', 'Nearly there'],
           ['quick', 'Under 15 min'], ['veg', 'Vegetarian']] as [Filter, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`chip shrink-0 ${filter === k
              ? 'border-brass-500/50 bg-brass-400/12 text-brass-300'
              : 'border-ink-600 bg-ink-800 text-ink-400'}`}
          >{label}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <Empty
            icon="🍳"
            title="Nothing in this list yet"
            hint="Add a few things to the fridge and the pantry — or tag a cupboard with what is in it — and this fills up."
          />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {shown.map(m => <RecipeCard key={m.recipe.id} match={m} onOpen={() => setOpen(m)} />)}
        </div>
      )}
      </>
      )}

      <RecipeSheet
        match={open}
        onClose={() => setOpen(null)}
        onShop={async (missing) => {
          // Creating them at zero is the whole trick: an item with none left is
          // already "out", so it lands on the shopping list through the normal
          // route rather than needing a parallel list of its own.
          for (const ing of missing) {
            await saveItem({
              name: ing.name, qty: 0, unit: 'pcs', parLevel: 1, minQty: 1,
              category: 'Pantry', notes: 'Wanted for a recipe',
            })
          }
        }}
      />
    </div>
  )
}

function Tally({ value, label, tone }: { value: number; label: string; tone: 'good' | 'warn' | 'flat' }) {
  const c = tone === 'good' ? 'text-mark-leaf' : tone === 'warn' ? 'text-mark-ochre' : 'text-ink-200'
  return (
    <div className="flex-1 border-r border-ink-700 px-3 py-2.5 last:border-0">
      <div className={`tnum text-xl font-semibold ${c}`}>{value}</div>
      <div className="text-micro text-ink-500">{label}</div>
    </div>
  )
}

function RecipeCard({ match, onOpen }: { match: Match; onOpen: () => void }) {
  const { recipe, missing, canCook } = match
  return (
    <button onClick={onOpen} className="panel block w-full px-3 py-3 text-left transition active:bg-ink-850">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-medium text-ink-200">{recipe.name}</div>
          <div className="mt-0.5 truncate text-mini text-ink-400">{recipe.blurb}</div>
        </div>
        <span className={`chip shrink-0 ${canCook
          ? 'border-mark-leaf/40 bg-mark-leaf/10 text-mark-leaf'
          : 'border-mark-ochre/40 bg-mark-ochre/10 text-mark-ochre'}`}>
          {canCook ? 'Ready' : `${missing.length} short`}
        </span>
      </div>
      {/* Every fixed part refuses to break: without shrink-0 the flex children
          were squeezed by the long "need …" list and "12 min" wrapped onto two
          lines as "12" and "min". Only the shortfall truncates. */}
      <div className="mt-1.5 flex items-center gap-1.5 text-micro text-ink-500">
        <span className="shrink-0 whitespace-nowrap font-medium text-ink-400">{recipe.cuisine}</span>
        <span className="shrink-0">·</span>
        <span className="shrink-0 whitespace-nowrap">{recipe.minutes} min</span>
        {canCook && (
          <>
            <span className="shrink-0">·</span>
            <span className="shrink-0 whitespace-nowrap">serves {recipe.serves}</span>
          </>
        )}
        {!canCook && (
          <>
            <span className="shrink-0">·</span>
            <span className="min-w-0 flex-1 truncate text-mark-ochre">
              need {missing.map(i => i.name.toLowerCase()).join(', ')}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function RecipeSheet({
  match, onClose, onShop,
}: {
  match: Match | null
  onClose: () => void
  onShop: (missing: Ingredient[]) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  if (!match) return null
  const { recipe, have, missing, missingTracked, missingUnknown, missingOptional, staplesOut, canCook } = match

  return (
    <Sheet
      open
      wide
      onClose={() => { setAdded(false); onClose() }}
      title={recipe.name}
      footer={
        missing.length > 0 ? (
          missingUnknown.length === 0 ? (
            <div className="text-center text-mini text-ink-400">
              Already on the shopping list — {missingTracked.map(i => i.name.toLowerCase()).join(' and ')} ran out.
            </div>
          ) : (
            <button
              className="btn btn-primary w-full"
              disabled={busy || added}
              onClick={async () => {
                setBusy(true)
                try { await onShop(missingUnknown); setAdded(true) } finally { setBusy(false) }
              }}
            >
              {added ? 'Added to the shopping list' : busy ? 'Adding…'
                : `Put ${missingUnknown.length === 1
                    ? missingUnknown[0].name.toLowerCase()
                    : `${missingUnknown.length} things`} on the list`}
            </button>
          )
        ) : (
          <div className="text-center text-mini text-ink-400">Everything for this is in the house.</div>
        )
      }
    >
      <p className="text-mini leading-relaxed text-ink-400">{recipe.blurb}</p>
      <div className="mt-1 text-micro text-ink-500">{recipe.cuisine} · {recipe.minutes} min · serves {recipe.serves}</div>

      <div className="panel mt-4 overflow-hidden">
        <header className="border-b border-ink-700 px-3 py-2 text-micro font-semibold uppercase tracking-wider text-ink-300">
          {canCook ? 'You have everything' : 'What you need'}
        </header>
        <ul className="divide-y divide-ink-700/60">
          {have.map(i => (
            <li key={i.name} className="flex items-center gap-2 px-3 py-2 text-sm text-ink-300">
              <span className="text-mark-leaf">✓</span>{i.name}
            </li>
          ))}
          {missing.map(i => (
            <li key={i.name} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-mark-ochre">
              <span>·</span>{i.name}
              {missingTracked.includes(i) && (
                <span className="text-micro font-normal text-ink-500">ran out — on the list</span>
              )}
            </li>
          ))}
          {missingOptional.map(i => (
            <li key={i.name} className="flex items-center gap-2 px-3 py-2 text-sm text-ink-500">
              <span>·</span>{i.name} <span className="text-micro">optional</span>
            </li>
          ))}
        </ul>
      </div>

      {staplesOut.length > 0 && (
        <p className="mt-3 rounded-lg bg-ink-850 px-3 py-2 text-xs leading-relaxed text-ink-400">
          Worth checking: {staplesOut.map(i => i.name.toLowerCase()).join(' and ')} shows as
          out. The recipe assumes you have some.
        </p>
      )}

      <div className="mt-4">
        <div className="text-micro font-semibold uppercase tracking-wider text-ink-500">Method</div>
        <ol className="mt-2 space-y-2.5">
          {recipe.steps.map((s, n) => (
            <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-ink-300">
              <span className="tnum shrink-0 font-semibold text-brass-400">{n + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  )
}

/** Used by the dashboard card so it agrees with this screen. */
export function cookableCount(
  items: Parameters<typeof buildPantry>[0],
  contents: (string | null | undefined)[],
): { ready: number; close: number } {
  const ms = matchAll(RECIPES, buildPantry(items, contents))
  return {
    ready: ms.filter(m => m.canCook).length,
    close: ms.filter(m => !m.canCook && m.missing.length <= 2).length,
  }
}
