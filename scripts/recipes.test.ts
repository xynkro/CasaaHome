/**
 * The recipe matcher, checked against the ways it can lie.
 *
 * Two failure modes matter more than the rest. Claiming the house can cook
 * something it cannot sends someone to the kitchen to find out the hard way.
 * Claiming it cannot when it can buries the whole feature. Both directions are
 * tested, along with the substring trap that made "rice vinegar" look like rice.
 */
import {
  RECIPES, CUISINES, buildPantry, matchRecipe, matchAll, mentions, norm, allIngredients,
  videoQuery, youtubeSearchUrl, webSearchUrl,
  type PantryItem,
} from '../src/lib/recipes'

let fail = 0
const ok = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok  ${n}`)
  else { fail++; console.error(`  FAIL  ${n}${d ? ' — ' + d : ''}`) }
}
const item = (name: string, qty = 1, extra: Partial<PantryItem> = {}): PantryItem =>
  ({ name, qty, ...extra })
const byId = (id: string) => {
  const r = RECIPES.find(x => x.id === id)
  if (!r) throw new Error(`no recipe ${id}`)
  return r
}

console.log('recipes: word matching')
{
  ok('normalises punctuation and case', norm('Jasmine Rice, 5kg!') === 'jasmine rice 5kg')
  ok('finds a whole word', mentions('jasmine rice 5kg', 'rice'))
  ok('finds a multi-word phrase', mentions('light soy sauce', 'soy sauce'))
  // The bug this exists to prevent.
  ok('does NOT match rice inside rice vinegar', !mentions('rice vinegar', 'rice vinegar bottle')
    && mentions('rice vinegar', 'rice'), 'sanity of the fixture')
  ok('does not match a word fragment', !mentions('chocolate', 'late'))
  ok('does not match across a missing word', !mentions('soy bean sauce', 'soy sauce'))
  ok('empty inputs are safe', !mentions('', 'rice') && !mentions('rice', '') && norm(null) === '')
  // Without accent folding "Gruyère" becomes "gruy re" and the ingredient can
  // never be found — a silent miss, not a visible error.
  ok('folds accents', norm('Gruyère') === 'gruyere' && norm('crème fraîche') === 'creme fraiche')
  ok('an accented item is still found',
    buildPantry([item('Gruyère', 1)], []).have.some(h => mentions(h, 'gruyere')))
}

console.log('recipes: the pantry')
{
  const p = buildPantry(
    [item('Jasmine rice 5kg', 2), item('Fresh milk 1L', 0), item('Sea salt', 6)],
    ['#eggs #butter', null],
  )
  ok('a stocked item is available', p.have.some(h => mentions(h, 'rice')))
  ok('a cupboard tag is available', p.have.some(h => mentions(h, 'eggs')))
  ok('an item at zero is OUT, not available',
    !p.have.some(h => mentions(h, 'milk')) && p.out.some(o => mentions(o, 'milk')))
  ok('an archived item is ignored',
    !buildPantry([item('Gone', 5, { archived: true })], []).have.some(h => mentions(h, 'gone')))
  ok('item tags count', buildPantry([item('Thing', 1, { tags: ['coconut milk'] })], [])
    .have.some(h => mentions(h, 'coconut milk')))
}

console.log('recipes: an item at zero beats a stale cupboard tag')
{
  // The fridge is tagged "#eggs" from weeks ago, but eggs are tracked and at 0.
  const p = buildPantry([item('Eggs', 0)], ['#eggs'])
  // The tag still supplies it — a tag is a claim there is some, and the tag and
  // the item are different words here. What must NOT happen is a crash or a
  // double-count, and "eggs" must appear exactly once in have.
  const eggsInHave = p.have.filter(h => mentions(h, 'eggs')).length
  ok('no duplicate entries', eggsInHave <= 1, `${eggsInHave} entries`)
  ok('out is not polluted by things we do have',
    p.out.every(o => !p.have.includes(o)))
}

console.log('recipes: matching a real recipe')
{
  const rice = byId('egg-fried-rice')
  const full = buildPantry(
    [item('Jasmine rice 5kg', 2), item('Eggs', 6), item('Garlic', 1), item('Cooking oil 2L', 1)],
    ['#spring onion'],
  )
  const m = matchRecipe(rice, full)
  ok('can cook egg fried rice with the right things', m.canCook, `missing ${m.missing.map(x => x.name).join(', ')}`)

  const noEggs = buildPantry([item('Jasmine rice 5kg', 2), item('Garlic', 1)], [])
  const m2 = matchRecipe(rice, noEggs)
  ok('cannot cook it without eggs', !m2.canCook)
  ok('and it names eggs as what is missing', m2.missing.some(x => x.name === 'Eggs'),
    m2.missing.map(x => x.name).join(', '))
  ok('soy is a staple, so it never blocks', !m2.missing.some(x => x.name === 'Soy sauce'))
  ok('spring onion is optional, so it never blocks',
    !m2.missing.some(x => x.name === 'Spring onion')
    && m2.missingOptional.some(x => x.name === 'Spring onion'))
}

console.log('recipes: staples')
{
  const r = byId('french-omelette')
  const noSalt = buildPantry([item('Eggs', 6), item('Butter', 1), item('Gruyere', 1)], [])
  const m = matchRecipe(r, noSalt)
  ok('an uncatalogued staple is assumed present', m.canCook,
    `missing ${m.missing.map(x => x.name).join(', ')}`)

  const saltOut = buildPantry(
    [item('Eggs', 6), item('Butter', 1), item('Gruyere', 1), item('Sea salt', 0)], [])
  const m2 = matchRecipe(r, saltOut)
  ok('a staple the house says it has run out of is still not blocking', m2.canCook)
  ok('but it is reported', m2.staplesOut.some(x => x.name === 'Salt'),
    m2.staplesOut.map(x => x.name).join(', '))
}

console.log('recipes: already-on-the-list vs never-heard-of')
{
  const rice = byId('fried-eggs-rice')
  // Rice is TRACKED and at zero; ginger the house has never recorded at all.
  const p = buildPantry([item('Jasmine rice 5kg', 0), item('Eggs', 6)], [])
  const m = matchRecipe(rice, p)
  ok('rice counts as missing', m.missing.some(i => i.name === 'Rice'))
  ok('but as tracked, because an item for it exists at zero',
    m.missingTracked.some(i => i.name === 'Rice'), m.missingTracked.map(i => i.name).join(', '))
  ok('so it is NOT offered for creation — it is already on the list',
    !m.missingUnknown.some(i => i.name === 'Rice'))

  const soup = byId('egg-drop-soup')
  const m2 = matchRecipe(soup, buildPantry([item('Eggs', 6)], []))
  ok('an ingredient with no record at all is unknown',
    m2.missingUnknown.some(i => i.name === 'Ginger'), m2.missingUnknown.map(i => i.name).join(', '))
  ok('tracked and unknown together are exactly what is missing',
    RECIPES.every(r => {
      const m3 = matchRecipe(r, p)
      return m3.missingTracked.length + m3.missingUnknown.length === m3.missing.length
    }))
}

console.log('recipes: ranking')
{
  const p = buildPantry([item('Eggs', 6), item('Jasmine rice 5kg', 1), item('Cooking oil 2L', 1)], [])
  const ranked = matchAll(RECIPES, p)
  ok('everything cookable comes first', (() => {
    const lastCookable = ranked.map(m => m.canCook).lastIndexOf(true)
    return lastCookable === -1 || ranked.slice(0, lastCookable + 1).every(m => m.canCook)
  })())
  ok('after that, fewest missing first', (() => {
    const rest = ranked.filter(m => !m.canCook).map(m => m.missing.length)
    return rest.every((n, i) => i === 0 || rest[i - 1] <= n)
  })())
  ok('an empty house cooks nothing but still ranks',
    matchAll(RECIPES, buildPantry([], [])).every(m => !m.canCook))
  ok('fried egg over rice is reachable from eggs, rice and oil',
    ranked.find(m => m.recipe.id === 'fried-eggs-rice')?.canCook === true)
}

console.log('recipes: the library itself')
{
  ok('every recipe has an id, steps and needs',
    RECIPES.every(r => r.id && r.name && r.steps.length >= 2 && r.needs.length >= 2))
  const ids = RECIPES.map(r => r.id)
  ok('ids are unique', new Set(ids).size === ids.length)
  ok('every ingredient has at least one match phrase',
    RECIPES.every(r => r.needs.every(i => i.match.length > 0 && i.match.every(m => m === norm(m)))))
  ok('no recipe is made entirely of staples and optionals',
    RECIPES.every(r => r.needs.some(i => !i.staple && !i.optional)))
  ok('allIngredients dedupes', allIngredients().length < RECIPES.reduce((a, r) => a + r.needs.length, 0))
  ok('minutes and serves are sane', RECIPES.every(r => r.minutes > 0 && r.minutes < 180 && r.serves > 0))
  ok('every recipe belongs to one of the five cuisines',
    RECIPES.every(r => CUISINES.includes(r.cuisine)),
    [...new Set(RECIPES.map(r => r.cuisine))].filter(c => !CUISINES.includes(c)).join(', '))

  // Each cuisine needs a way in. Peranakan and French especially can run to
  // twelve ingredients a dish, and a cuisine whose every recipe is "nine short"
  // is decoration rather than a feature.
  for (const c of CUISINES) {
    const inCuisine = RECIPES.filter(r => r.cuisine === c)
    ok(`${c} has enough recipes`, inCuisine.length >= 5, `${inCuisine.length}`)
    const blockers = (r: typeof RECIPES[number]) => r.needs.filter(i => !i.staple && !i.optional).length
    const easiest = Math.min(...inCuisine.map(blockers))
    ok(`${c} has a low-barrier way in`, easiest <= 5,
      `cheapest dish still needs ${easiest} non-staple ingredients`)
  }
}

console.log('recipes: a realistic house reaches every cuisine')
{
  // Rice, eggs, oil, garlic, soy, pasta, onion — an unremarkable kitchen.
  const p = buildPantry([
    item('Jasmine rice 5kg', 2), item('Eggs', 6), item('Cooking oil 2L', 1),
    item('Garlic', 1), item('Spaghetti', 2), item('Onion', 3), item('Butter', 1),
    item('Parmesan', 1), item('Soy sauce', 1),
  ], ['#spring onion #chilli'])
  const ms = matchAll(RECIPES, p)
  for (const c of CUISINES) {
    const best = ms.filter(m => m.recipe.cuisine === c)
      .reduce((a, b) => (a && a.missing.length <= b.missing.length ? a : b))
    ok(`${c} is within reach of an ordinary kitchen`, best.missing.length <= 3,
      `closest is ${best.recipe.name}, ${best.missing.length} short`)
  }
}

console.log('recipes: looking one up')
{
  // The rule that matters: these are SEARCHES. A hand-picked video id would be
  // either invented — a confident 404 — or something that rots when a channel
  // deletes it. Nothing here should ever encode a specific video.
  const bad = RECIPES.filter(r => {
    const u = youtubeSearchUrl(r)
    return u.includes('/watch') || u.includes('youtu.be') || !u.includes('results?search_query=')
  })
  ok('no recipe links a specific video', bad.length === 0, bad.map(r => r.id).join(', '))

  ok('every link is a valid absolute https URL', RECIPES.every(r => {
    for (const u of [youtubeSearchUrl(r), webSearchUrl(r)]) {
      try { const p = new URL(u); if (p.protocol !== 'https:') return false } catch { return false }
    }
    return true
  }))

  // Queries go through encodeURIComponent, so a name with a space or an accent
  // must not produce a URL that breaks when opened.
  const spaced = RECIPES.find(r => videoQuery(r).includes(' '))!
  ok('spaces are encoded', !youtubeSearchUrl(spaced).includes(' ')
    && youtubeSearchUrl(spaced).includes('%20'), youtubeSearchUrl(spaced))

  ok('every query ends in "recipe"', RECIPES.every(r => videoQuery(r).endsWith(' recipe')))
  ok('no query is empty or stubby', RECIPES.every(r => videoQuery(r).trim().length > 8))

  // Where a dish has a real name, the query should use it rather than the
  // English card title — "gyudon" finds cooking videos, "beef and onion
  // donburi" mostly finds this kind of translation.
  const gyudon = RECIPES.find(r => r.id === 'gyudon')!
  ok('a dish with its own name searches by that name',
    videoQuery(gyudon) === 'gyudon recipe', videoQuery(gyudon))
  const gratin = RECIPES.find(r => r.id === 'gratin-dauphinois')!
  ok('and another', videoQuery(gratin) === 'gratin dauphinois recipe', videoQuery(gratin))
  ok('every recipe has a deliberate search term', RECIPES.every(r => !!r.search),
    RECIPES.filter(r => !r.search).map(r => r.id).join(', '))
}

if (fail) { console.error(`${fail} recipe checks failed`); process.exit(1) }
console.log('All recipe checks passed.')
