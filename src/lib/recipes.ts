/**
 * What can we cook with what is actually in the house?
 *
 * This is deliberately a local match against a fixed library rather than
 * anything generated. Two reasons. The client bundle must never carry an API
 * key (see CLAUDE.md), so a live model call would have to go through the hourly
 * GitHub Action, and "what can I cook right now" is a question you ask while
 * standing in the kitchen at 7pm — an hourly job is the wrong shape entirely.
 * The second reason is that a fixed library is testable: matching is the part
 * that can be wrong, and it can be checked.
 *
 * The honest limitation, stated up front: this house tracks staples, not every
 * ingredient. Most of it is photographed and tagged rather than itemised. So a
 * matcher that only answered "yes you can cook this" would say almost nothing.
 * Being SHORT of two things is the normal state, and the useful answer, so the
 * shortfall is what the ranking is built around.
 */

export interface Ingredient {
  /** How it reads in a list. */
  name: string
  /** Whole-word phrases that identify it in a name, tag or cupboard note. */
  match: string[]
  /**
   * Salt, oil, water. Assumed present unless the house explicitly says it has
   * run out, because nobody catalogues salt and blocking on it would bury every
   * recipe behind a pantry entry nobody is going to make.
   */
  staple?: boolean
  /** Nice to have. Never blocks, listed as a suggestion. */
  optional?: boolean
}

export interface Recipe {
  id: string
  name: string
  blurb: string
  minutes: number
  serves: number
  needs: Ingredient[]
  steps: string[]
  tags: string[]
}

export interface Pantry {
  /** Normalised phrases the house can currently supply. */
  have: string[]
  /** Phrases that exist as tracked items but have run out. */
  out: string[]
}

export interface Match {
  recipe: Recipe
  have: Ingredient[]
  /** Everything blocking the recipe: tracked-but-empty plus never-heard-of. */
  missing: Ingredient[]
  /**
   * Missing because a tracked item has run out. These are already on the
   * shopping list — being at zero is what puts them there — so offering to add
   * them again would only create a second entry for the same thing. The house
   * has "Jasmine rice 5kg"; it does not also need one called "Rice".
   */
  missingTracked: Ingredient[]
  /** Missing with no record at all. These are the ones worth creating. */
  missingUnknown: Ingredient[]
  /** Optional extras that are not around. Never blocks. */
  missingOptional: Ingredient[]
  /** Staples the house has explicitly run out of — worth saying, still cookable. */
  staplesOut: Ingredient[]
  canCook: boolean
}

const WORD = /[^a-z0-9]+/g

/** Lowercase, strip punctuation, collapse spaces. */
export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(WORD, ' ').trim()
}

/**
 * Whole-word containment, not substring.
 *
 * Substring matching looked fine until "rice" found "rice vinegar" and claimed
 * the house could make fried rice out of a condiment. Padding both sides forces
 * the phrase to land on word boundaries.
 */
export function mentions(haystack: string, phrase: string): boolean {
  if (!haystack || !phrase) return false
  return ` ${haystack} `.includes(` ${phrase} `)
}

export function ingredientIn(ing: Ingredient, sources: string[]): boolean {
  return sources.some(s => ing.match.some(m => mentions(s, m)))
}

/** Rank: cookable first, then fewest things missing, then quickest. */
export function rankMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) =>
    Number(b.canCook) - Number(a.canCook)
    || a.missing.length - b.missing.length
    || a.recipe.minutes - b.recipe.minutes
    || a.recipe.name.localeCompare(b.recipe.name))
}

export function matchRecipe(recipe: Recipe, pantry: Pantry): Match {
  const have: Ingredient[] = []
  const missing: Ingredient[] = []
  const missingTracked: Ingredient[] = []
  const missingUnknown: Ingredient[] = []
  const missingOptional: Ingredient[] = []
  const staplesOut: Ingredient[] = []

  for (const ing of recipe.needs) {
    const present = ingredientIn(ing, pantry.have)
    const ranOut = ingredientIn(ing, pantry.out)

    if (present) { have.push(ing); continue }
    if (ing.staple) {
      // Assumed present unless the house says otherwise.
      if (ranOut) staplesOut.push(ing); else have.push(ing)
      continue
    }
    if (ing.optional) { missingOptional.push(ing); continue }
    missing.push(ing)
    ;(ranOut ? missingTracked : missingUnknown).push(ing)
  }

  return {
    recipe, have, missing, missingTracked, missingUnknown, missingOptional, staplesOut,
    canCook: missing.length === 0,
  }
}

export function matchAll(recipes: Recipe[], pantry: Pantry): Match[] {
  return rankMatches(recipes.map(r => matchRecipe(r, pantry)))
}

/* ------------------------------------------------------------------ */

const ing = (name: string, match: string[], extra: Partial<Ingredient> = {}): Ingredient =>
  ({ name, match, ...extra })

const SALT = ing('Salt', ['salt', 'sea salt'], { staple: true })
const OIL = ing('Cooking oil', ['oil', 'cooking oil', 'vegetable oil', 'olive oil'], { staple: true })
const PEPPER = ing('Pepper', ['pepper', 'black pepper', 'white pepper'], { staple: true })
const SOY = ing('Soy sauce', ['soy sauce', 'soy', 'light soy'], { staple: true })
const GARLIC = ing('Garlic', ['garlic'])
const ONION = ing('Onion', ['onion', 'onions', 'shallot', 'shallots'])
const EGGS = ing('Eggs', ['egg', 'eggs'])
const RICE = ing('Rice', ['rice', 'jasmine rice', 'white rice'])
const MILK = ing('Milk', ['milk', 'fresh milk'])
const BUTTER = ing('Butter', ['butter'])
const FLOUR = ing('Flour', ['flour', 'plain flour'])
const SUGAR = ing('Sugar', ['sugar'], { staple: true })
const PASTA = ing('Pasta', ['pasta', 'spaghetti', 'penne', 'macaroni'])
const NOODLES = ing('Noodles', ['noodles', 'instant noodles', 'ramen', 'mee'])
const BREAD = ing('Bread', ['bread', 'loaf', 'toast'])
const CHEESE = ing('Cheese', ['cheese', 'cheddar', 'parmesan'])
const TOMATO = ing('Tomatoes', ['tomato', 'tomatoes', 'canned tomatoes'])
const CHICKEN = ing('Chicken', ['chicken', 'chicken breast', 'chicken thigh'])
const OYSTER = ing('Oyster sauce', ['oyster sauce'])
const SESAME = ing('Sesame oil', ['sesame oil'], { optional: true })
const CHILLI = ing('Chilli', ['chilli', 'chili', 'chilli flakes'], { optional: true })
const SPRING = ing('Spring onion', ['spring onion', 'scallion', 'scallions'], { optional: true })
const GINGER = ing('Ginger', ['ginger'])
const POTATO = ing('Potatoes', ['potato', 'potatoes'])
const CARROT = ing('Carrots', ['carrot', 'carrots'])
const STOCK = ing('Stock cube', ['stock', 'stock cube', 'bouillon'], { optional: true })
const TUNA = ing('Tinned tuna', ['tuna'])
const BEANS = ing('Tinned beans', ['beans', 'baked beans', 'chickpeas'])
const CURRY = ing('Curry powder', ['curry powder', 'curry'])
const COCONUT = ing('Coconut milk', ['coconut milk', 'coconut'])

export const RECIPES: Recipe[] = [
  {
    id: 'egg-fried-rice', name: 'Egg fried rice', minutes: 15, serves: 2,
    blurb: 'The one that exists because there is leftover rice.',
    needs: [RICE, EGGS, OIL, SOY, SPRING, GARLIC],
    tags: ['quick', 'one-pan', 'vegetarian'],
    steps: [
      'Day-old rice works far better than fresh — the grains stay separate.',
      'Beat the eggs. Get the pan hotter than feels sensible, oil in, eggs in, scramble and lift out while still soft.',
      'Garlic in the same pan for ten seconds, then the rice. Press it flat and leave it alone so it toasts.',
      'Eggs back, soy round the edge of the pan rather than over the rice, toss, spring onion, off the heat.',
    ],
  },
  {
    id: 'garlic-noodles', name: 'Garlic butter noodles', minutes: 12, serves: 2,
    blurb: 'Store-cupboard, and better than it has any right to be.',
    needs: [NOODLES, GARLIC, BUTTER, SOY, CHILLI, SPRING],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Boil the noodles a minute short of the packet time. Keep a mug of the water.',
      'Melt butter gently with sliced garlic — pale gold, not brown, or it turns bitter.',
      'Noodles into the butter with a splash of the cooking water and the soy. Toss hard until it clings.',
      'Chilli and spring onion off the heat.',
    ],
  },
  {
    id: 'tomato-pasta', name: 'Tomato and garlic pasta', minutes: 20, serves: 2,
    blurb: 'Four things, one pan of sauce.',
    needs: [PASTA, TOMATO, GARLIC, OIL, SALT, CHEESE, CHILLI],
    tags: ['vegetarian'],
    steps: [
      'Pasta into well-salted boiling water.',
      'Sliced garlic into cold oil, warm it slowly so the garlic infuses rather than fries.',
      'Tomatoes in, crush them, simmer while the pasta cooks. Season properly.',
      'Drain the pasta wet and finish it in the sauce for a minute. Cheese off the heat.',
    ],
  },
  {
    id: 'scrambled-eggs-toast', name: 'Proper scrambled eggs on toast', minutes: 10, serves: 2,
    blurb: 'Low heat and patience, nothing else.',
    needs: [EGGS, BREAD, BUTTER, MILK, SALT, PEPPER],
    tags: ['quick', 'breakfast', 'vegetarian'],
    steps: [
      'Beat the eggs with a splash of milk and a pinch of salt.',
      'Butter in a cold pan, eggs in, then the lowest heat you have.',
      'Stir slowly and constantly. It will look like nothing is happening, then all at once it will.',
      'Off the heat while still glossy and slightly underdone — it carries on cooking. Toast under.',
    ],
  },
  {
    id: 'chicken-rice-quick', name: 'Ginger soy chicken with rice', minutes: 30, serves: 2,
    blurb: 'A weeknight version, one pan and a rice cooker.',
    needs: [CHICKEN, RICE, GINGER, GARLIC, SOY, OYSTER, SESAME, SPRING],
    tags: ['one-pan'],
    steps: [
      'Rice on. Slice the chicken thin against the grain.',
      'Ginger and garlic in hot oil until they smell like dinner, about thirty seconds.',
      'Chicken in, spread out, leave it to colour before you touch it.',
      'Soy and oyster sauce with a splash of water, bubble down until it coats. Sesame oil and spring onion off the heat.',
    ],
  },
  {
    id: 'fried-eggs-rice', name: 'Fried egg over rice', minutes: 8, serves: 1,
    blurb: 'When cooking is not really on the table.',
    needs: [RICE, EGGS, SOY, OIL, CHILLI],
    tags: ['quick', 'vegetarian', 'one-pan'],
    steps: [
      'Hot oil, egg in, spoon the oil over the white until the edges frill and crisp.',
      'Onto hot rice, yolk still running.',
      'Soy over the top, chilli if you want it.',
    ],
  },
  {
    id: 'tuna-pasta', name: 'Tuna and tomato pasta', minutes: 20, serves: 2,
    blurb: 'Entirely from tins and still good.',
    needs: [PASTA, TUNA, TOMATO, GARLIC, OIL, CHILLI],
    tags: ['storecupboard'],
    steps: [
      'Pasta on in salted water.',
      'Garlic in oil, tomatoes in, simmer and season.',
      'Tuna in at the end with its oil — break it up but leave some texture.',
      'Toss through the drained pasta with a spoon of the cooking water.',
    ],
  },
  {
    id: 'potato-omelette', name: 'Potato omelette', minutes: 30, serves: 2,
    blurb: 'Cheap, filling, good cold the next day.',
    needs: [POTATO, EGGS, ONION, OIL, SALT],
    tags: ['vegetarian'],
    steps: [
      'Slice the potatoes thin. Cook them gently in plenty of oil with the onion until soft, not brown.',
      'Drain them and fold into beaten, well-salted eggs. Let it sit ten minutes.',
      'Back into a smaller pan on low heat until almost set.',
      'Plate over the top, flip, slide back in for two more minutes.',
    ],
  },
  {
    id: 'curry-veg', name: 'Coconut vegetable curry', minutes: 30, serves: 3,
    blurb: 'Whatever vegetables are on their way out.',
    needs: [COCONUT, CURRY, ONION, GARLIC, POTATO, CARROT, RICE, OIL],
    tags: ['vegetarian'],
    steps: [
      'Onion in oil until soft and sweet. Garlic and curry powder in, fry a minute so it stops tasting raw.',
      'Potato and carrot in, coat them in the paste.',
      'Coconut milk in, simmer covered until the potato gives to a knife, twenty minutes or so.',
      'Season hard — coconut swallows salt. Rice alongside.',
    ],
  },
  {
    id: 'beans-toast', name: 'Beans on toast, done properly', minutes: 10, serves: 2,
    blurb: 'Not an admission of defeat if you season it.',
    needs: [BEANS, BREAD, BUTTER, CHEESE, PEPPER],
    tags: ['quick', 'vegetarian', 'storecupboard'],
    steps: [
      'Beans into a small pan on low, not the microwave. Let them reduce slightly.',
      'Toast, buttered right to the edges.',
      'Beans over, cheese on top so it melts into them, plenty of black pepper.',
    ],
  },
  {
    id: 'chicken-noodle-soup', name: 'Chicken noodle soup', minutes: 25, serves: 2,
    blurb: 'For when someone is not feeling well.',
    needs: [CHICKEN, NOODLES, GINGER, GARLIC, CARROT, STOCK, SOY, SPRING],
    tags: ['one-pan'],
    steps: [
      'Ginger and garlic in a little oil, then water or stock in.',
      'Carrot in, simmer until nearly tender.',
      'Sliced chicken in — it needs three or four minutes, no more.',
      'Noodles in for the last two. Soy to season, spring onion at the table.',
    ],
  },
  {
    id: 'pancakes', name: 'Pancakes', minutes: 20, serves: 2,
    blurb: 'Flour, eggs, milk. Sunday.',
    needs: [FLOUR, EGGS, MILK, BUTTER, SUGAR, SALT],
    tags: ['breakfast', 'vegetarian'],
    steps: [
      'Whisk flour, a pinch of salt and a spoon of sugar. Eggs and milk in, whisk to a smooth batter.',
      'Rest it twenty minutes if you can be bothered — it is noticeably better.',
      'Butter a hot pan, ladle in, flip when the surface bubbles and the edges set.',
    ],
  },
  {
    id: 'garlic-bread', name: 'Garlic bread', minutes: 15, serves: 2,
    blurb: 'Bread that has gone slightly stale, rescued.',
    needs: [BREAD, BUTTER, GARLIC, CHEESE],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Mash crushed garlic into soft butter with a pinch of salt.',
      'Split or slice the bread, butter it generously into every cut.',
      'Hot oven until the edges are crisp. Cheese on for the last few minutes if you want it.',
    ],
  },
  {
    id: 'stirfry-veg', name: 'Whatever-is-left stir fry', minutes: 15, serves: 2,
    blurb: 'The honest answer to a half-empty fridge.',
    needs: [CARROT, ONION, GARLIC, SOY, OIL, OYSTER, RICE, CHILLI],
    tags: ['quick', 'one-pan', 'vegetarian'],
    steps: [
      'Cut everything to roughly the same size so it cooks at the same rate.',
      'Pan as hot as it goes. Hardest vegetables first, softest last.',
      'Keep it moving. If it steams instead of frying, the pan is too full — do it in two batches.',
      'Soy and oyster sauce at the very end so they glaze rather than boil.',
    ],
  },
  {
    id: 'french-toast', name: 'French toast', minutes: 15, serves: 2,
    blurb: 'The other thing to do with tired bread.',
    needs: [BREAD, EGGS, MILK, BUTTER, SUGAR],
    tags: ['breakfast', 'quick', 'vegetarian'],
    steps: [
      'Beat eggs with milk and a little sugar in a wide dish.',
      'Soak the bread properly — count to ten a side. Thin bread needs less.',
      'Medium heat, butter, until deep gold on both sides.',
    ],
  },
  {
    id: 'egg-drop-soup', name: 'Egg drop soup', minutes: 12, serves: 2,
    blurb: 'Five minutes and a stock cube.',
    needs: [EGGS, STOCK, GINGER, SPRING, SOY],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Stock and a slice of ginger up to a bare simmer.',
      'Beat the eggs. Take the pan off the boil, stir the soup into a slow spiral and pour the egg in a thin stream.',
      'Leave it ten seconds before stirring or you get scrambled egg soup.',
      'Soy to season, spring onion over.',
    ],
  },
  {
    id: 'mac-cheese', name: 'Macaroni cheese', minutes: 30, serves: 3,
    blurb: 'A roux is not hard and this is the proof.',
    needs: [PASTA, CHEESE, MILK, BUTTER, FLOUR, PEPPER],
    tags: ['vegetarian'],
    steps: [
      'Pasta on. Meanwhile melt equal butter and flour and cook it two minutes so it stops tasting of flour.',
      'Milk in a splash at a time, whisking, until smooth and thick enough to coat a spoon.',
      'Off the heat, cheese in — it splits if you boil it after.',
      'Fold the drained pasta through, plenty of pepper. Under a grill if you want a top.',
    ],
  },
  {
    id: 'chicken-curry', name: 'Chicken curry', minutes: 40, serves: 3,
    blurb: 'Worth the extra twenty minutes.',
    needs: [CHICKEN, CURRY, COCONUT, ONION, GARLIC, GINGER, RICE, OIL, POTATO],
    tags: [],
    steps: [
      'Onion slowly in oil until properly golden — this is most of the flavour, do not rush it.',
      'Garlic, ginger and curry powder in, one minute.',
      'Chicken in to colour, then coconut milk and the potato.',
      'Simmer uncovered until the sauce thickens and the potato is soft, around twenty-five minutes. Rice alongside.',
    ],
  },
]

/** Every distinct non-staple ingredient across the library, for the shopping hand-off. */
export function allIngredients(recipes: Recipe[] = RECIPES): Ingredient[] {
  const seen = new Map<string, Ingredient>()
  for (const r of recipes) for (const i of r.needs) if (!seen.has(i.name)) seen.set(i.name, i)
  return [...seen.values()]
}

/* ------------------------------------------------------------------ */

/** The minimum this needs to know about an item; keeps lib free of the store. */
export interface PantryItem {
  name: string
  brand?: string
  tags?: string[]
  notes?: string
  qty: number
  archived?: boolean
}

/**
 * What the house can currently supply.
 *
 * Three sources, in descending order of confidence: a tracked item with a
 * count above zero, that item's tags, and the free-text tags on a cupboard.
 * The cupboard tags matter more than they look — most of this house is
 * photographed and tagged rather than itemised, so "#eggs" written on the
 * fridge is often the only record that there are eggs, and ignoring it would
 * make the whole feature answer "no" to everything.
 *
 * A cupboard tag carries no count, so it can only ever say "there is some".
 * A tracked item at zero is the one thing that can say "there is none", and it
 * wins: an explicit count of nothing beats a tag written weeks ago.
 */
export function buildPantry(
  items: PantryItem[],
  locationContents: (string | null | undefined)[] = [],
): Pantry {
  const have: string[] = []
  const out: string[] = []

  for (const i of items) {
    if (i.archived) continue
    const words = [i.name, i.brand, ...(i.tags ?? []), i.notes]
      .filter(Boolean).map(w => norm(w as string)).filter(Boolean)
    ;(i.qty > 0 ? have : out).push(...words)
  }
  for (const c of locationContents) {
    const n = norm(c)
    if (n) have.push(n)
  }

  // An item you have beats the same word appearing on an empty one.
  const haveSet = new Set(have)
  return { have: [...haveSet], out: out.filter(o => !haveSet.has(o)) }
}
