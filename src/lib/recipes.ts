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
  /**
   * Phrases that DISQUALIFY a source, however well it otherwise matched.
   *
   * Whole-word matching stopped "rice" finding the middle of "liquorice", but
   * it cannot help when the ingredient's name is the head noun of a different
   * food: "rice vinegar" contains the whole word rice, "spring onion" contains
   * onion, "chicken stock" contains chicken. Without this a bottle of rice
   * vinegar in the cupboard reads as a bag of rice, and the app cheerfully
   * says you can make fried rice.
   *
   * Evaluated per SOURCE STRING: a source carrying a disqualifying phrase does
   * not count at all, even if it also carries a good one. That under-claims in
   * the rare mixed case, which is the right direction to be wrong — telling
   * someone they might be out of rice is recoverable, sending them to the hob
   * to cook a condiment is not.
   */
  not?: string[]
}

/**
 * The five the household actually cooks. Everything in the library belongs to
 * one of them — there is no "other" bucket, because a junk drawer of beans on
 * toast would rank alongside the food someone actually wants to eat.
 */
export type Cuisine = 'Peranakan' | 'Chinese' | 'Japanese' | 'Italian' | 'French'

export const CUISINES: Cuisine[] = ['Peranakan', 'Chinese', 'Japanese', 'Italian', 'French']

export interface Recipe {
  id: string
  name: string
  cuisine: Cuisine
  /**
   * What to search for when the card's title is not the best query — usually
   * because the dish has a real name in its own language that finds far better
   * videos than the English description does. "gyudon" rather than "beef and
   * onion donburi"; "gratin dauphinois" rather than "potato gratin".
   */
  search?: string
  blurb: string
  minutes: number
  serves: number
  needs: Ingredient[]
  steps: string[]
  tags: string[]
}

export interface Pantry {
  /** Phrases from TRACKED items with something left. The strongest evidence. */
  have: string[]
  /** Phrases from tracked items at zero. The only source that can say "none". */
  out: string[]
  /**
   * Phrases from cupboard notes. These carry no count, so a tag can only ever
   * claim "there is some" — and a tracked item at zero overrules it. Correcting
   * eggs to zero has to make the omelette stop being cookable, or the app's
   * primary interaction changes nothing on the screen that reads it.
   */
  tags: string[]
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
const MARKS = /[\u0300-\u036f]/g

/**
 * Lowercase, fold accents, strip punctuation, collapse spaces.
 *
 * The accent folding is not cosmetic. Without it "Gruyère" normalises to
 * "gruy re" — the accented letter becomes a word break — so the ingredient
 * could never be found in anything, and the failure is silent: the recipe just
 * quietly claims you do not have a cheese that is sitting in the fridge.
 */
export function norm(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(MARKS, '').toLowerCase().replace(WORD, ' ').trim()
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
  return sources.some(s =>
    ing.match.some(m => mentions(s, m))
    && !(ing.not ?? []).some(n => mentions(s, n)))
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
    const ranOut = ingredientIn(ing, pantry.out)
    // A cupboard tag is a claim there is some, written at some point in the
    // past. A tracked item at zero is a count taken deliberately, just now.
    // The count wins — otherwise correcting eggs to zero leaves the omelette
    // sitting there as cookable and the correction appears to do nothing.
    const present = ingredientIn(ing, pantry.have)
      || (!ranOut && ingredientIn(ing, pantry.tags))

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

/* Assumed present unless the house says it has run out. */
const SALT = ing('Salt', ['salt', 'sea salt'], { staple: true })
const OIL = ing('Cooking oil', ['oil', 'cooking oil', 'vegetable oil'],
  { staple: true, not: ['sesame oil', 'olive oil', 'truffle oil'] })
const PEPPER = ing('Pepper', ['pepper', 'black pepper', 'white pepper'], { staple: true })
const SUGAR = ing('Sugar', ['sugar'], { staple: true })
const SOY = ing('Soy sauce', ['soy sauce', 'soy', 'light soy'], { staple: true })

/* Everyday */
const EGGS = ing('Eggs', ['egg', 'eggs'])
const RICE = ing('Rice', ['rice', 'jasmine rice', 'white rice'],
  { not: ['rice vinegar', 'rice wine', 'rice noodles', 'risotto rice', 'wild rice'] })
const GARLIC = ing('Garlic', ['garlic'])
const ONION = ing('Onion', ['onion', 'onions'], { not: ['spring onion', 'spring onions'] })
const SHALLOT = ing('Shallots', ['shallot', 'shallots'])
const GINGER = ing('Ginger', ['ginger'])
const SPRING = ing('Spring onion', ['spring onion', 'spring onions', 'scallion', 'scallions'], { optional: true })
const CHILLI = ing('Chilli', ['chilli', 'chili', 'red chilli'])
/** The same thing where it is a garnish rather than the point of the dish. */
const CHILLI_OPT = ing('Chilli', ['chilli', 'chili', 'red chilli'], { optional: true })
const BUTTER = ing('Butter', ['butter'])
const MILK = ing('Milk', ['milk', 'fresh milk'])
const CREAM = ing('Cream', ['cream', 'double cream', 'whipping cream'])
const FLOUR = ing('Flour', ['flour', 'plain flour'])
const POTATO = ing('Potatoes', ['potato', 'potatoes'])
const CARROT = ing('Carrots', ['carrot', 'carrots'])
const TOMATO = ing('Tomatoes', ['tomato', 'tomatoes', 'canned tomatoes'])
const CUCUMBER = ing('Cucumber', ['cucumber'])
const CABBAGE = ing('Cabbage', ['cabbage'])
const BREAD = ing('Bread', ['bread', 'loaf', 'baguette'])
const CHICKEN = ing('Chicken', ['chicken', 'chicken thigh', 'chicken breast'],
  { not: ['chicken stock', 'chicken powder', 'chicken cube'] })
const PORK = ing('Pork', ['pork', 'pork belly', 'minced pork'])
const PRAWNS = ing('Prawns', ['prawn', 'prawns', 'shrimp'])
const TOFU = ing('Tofu', ['tofu', 'tau kwa', 'beancurd'])
const STOCK = ing('Stock', ['stock', 'stock cube', 'bouillon', 'broth'])
/** Where the steps say "water or stock" and mean it. */
const STOCK_OPT = ing('Stock', ['stock', 'stock cube', 'bouillon', 'broth'], { optional: true })
const LIME = ing('Lime', ['lime', 'calamansi'], { optional: true })
const CORNFLOUR = ing('Cornflour', ['cornflour', 'cornstarch'], { optional: true })

/* Peranakan */
const BELACAN = ing('Belacan', ['belacan', 'shrimp paste'])
const LEMONGRASS = ing('Lemongrass', ['lemongrass', 'serai'])
const GALANGAL = ing('Galangal', ['galangal', 'lengkuas'], { optional: true })
const TURMERIC = ing('Turmeric', ['turmeric', 'kunyit'])
const CANDLENUT = ing('Candlenuts', ['candlenut', 'candlenuts', 'buah keras'], { optional: true })
const COCONUT = ing('Coconut milk', ['coconut milk', 'coconut cream', 'santan'])
const TAMARIND = ing('Tamarind', ['tamarind', 'assam'])
const LAKSA_LEAF = ing('Laksa leaf', ['laksa leaf', 'daun kesum', 'vietnamese mint'], { optional: true })
const PALM_SUGAR = ing('Palm sugar', ['palm sugar', 'gula melaka'], { optional: true })
const DRIED_SHRIMP = ing('Dried shrimp', ['dried shrimp', 'hae bee'], { optional: true })
const KAFFIR = ing('Kaffir lime leaf', ['kaffir lime leaf', 'lime leaf'], { optional: true })
const CURRY_POWDER = ing('Curry powder', ['curry powder'])
const RICE_NOODLES = ing('Rice noodles', ['rice noodles', 'bee hoon', 'vermicelli', 'laksa noodles'])
const BEANSPROUTS = ing('Beansprouts', ['beansprouts', 'bean sprouts', 'taugeh'], { optional: true })

/* Chinese */
const OYSTER = ing('Oyster sauce', ['oyster sauce'])
const SESAME = ing('Sesame oil', ['sesame oil'])
const SHAOXING = ing('Shaoxing wine', ['shaoxing', 'rice wine', 'cooking wine'], { optional: true })
const VINEGAR = ing('Rice vinegar', ['rice vinegar', 'black vinegar', 'chinkiang'], { optional: true })
const NOODLES = ing('Noodles', ['noodles', 'egg noodles', 'mee', 'ramen'])
const DARK_SOY = ing('Dark soy sauce', ['dark soy', 'dark soy sauce'], { optional: true })
const CHOY = ing('Greens', ['greens', 'green vegetable', 'choy sum', 'bok choy', 'kai lan', 'spinach'])

/* Japanese */
const MIRIN = ing('Mirin', ['mirin'])
const DASHI = ing('Dashi', ['dashi', 'bonito', 'katsuobushi'], { optional: true })
const MISO = ing('Miso', ['miso', 'miso paste'])
const NORI = ing('Nori', ['nori', 'seaweed'], { optional: true })
const PANKO = ing('Panko', ['panko', 'breadcrumbs'])
const SAKE = ing('Sake', ['sake'], { optional: true })
const SESAME_SEEDS = ing('Sesame seeds', ['sesame seeds', 'sesame seed'], { optional: true })

/* Italian */
const PASTA = ing('Pasta', ['pasta', 'spaghetti', 'penne', 'linguine', 'rigatoni'])
const OLIVE_OIL = ing('Olive oil', ['olive oil', 'extra virgin'])
const PARMESAN = ing('Parmesan', ['parmesan', 'parmigiano', 'pecorino', 'hard cheese'])
/** Grated over at the table rather than cooked in. */
const PARMESAN_OPT = ing('Parmesan', ['parmesan', 'parmigiano', 'pecorino', 'hard cheese'], { optional: true })
const BASIL = ing('Basil', ['basil'], { optional: true })
const PANCETTA = ing('Pancetta', ['pancetta', 'guanciale', 'bacon'])
const ANCHOVY = ing('Anchovies', ['anchovy', 'anchovies'])
const ARBORIO = ing('Risotto rice', ['risotto rice', 'arborio', 'carnaroli'])
const WHITE_WINE = ing('White wine', ['white wine', 'wine'], { optional: true })
const MOZZARELLA = ing('Mozzarella', ['mozzarella'])
const CANNELLINI = ing('Tinned beans', ['tinned beans', 'cannellini', 'butter beans', 'chickpeas', 'beans'])

/* French */
const DIJON = ing('Dijon mustard', ['dijon', 'mustard'])
const THYME = ing('Thyme', ['thyme', 'herbs de provence', 'mixed herbs'], { optional: true })
const GRUYERE = ing('Gruyere', ['gruyere', 'emmental', 'cheese'])
const HAM = ing('Ham', ['ham', 'jambon'])
const LENTILS = ing('Lentils', ['lentils', 'puy lentils'])
const VINEGAR_W = ing('Wine vinegar', ['wine vinegar', 'red wine vinegar', 'vinegar'], { optional: true })

export const RECIPES: Recipe[] = [
  /* ---------------- Peranakan ---------------- */
  {
    id: 'sambal-telur', name: 'Sambal telur', cuisine: 'Peranakan', search: 'sambal telur', minutes: 25, serves: 2,
    blurb: 'Hard-boiled eggs in a proper sambal. The gateway dish.',
    needs: [EGGS, CHILLI, SHALLOT, GARLIC, BELACAN, TAMARIND, SUGAR, OIL],
    tags: ['quick'],
    steps: [
      'Boil the eggs eight minutes, peel them, and fry them whole until the outsides blister and go golden. Set aside.',
      'Blend chilli, shallots, garlic and belacan into a rough paste.',
      'Fry the paste in a good amount of oil on a low flame until it darkens and the oil separates out — ten minutes, and do not rush it. This step IS the dish.',
      'Tamarind water and a little sugar in, taste for the sour-sweet-salt balance, then roll the eggs through it.',
    ],
  },
  {
    id: 'nasi-goreng-belacan', name: 'Belacan fried rice', cuisine: 'Peranakan', search: 'nasi goreng belacan', minutes: 20, serves: 2,
    blurb: 'Fried rice with the volume turned up.',
    needs: [RICE, EGGS, BELACAN, CHILLI, SHALLOT, GARLIC, OIL, CUCUMBER],
    tags: ['quick', 'one-pan'],
    steps: [
      'Pound or blend chilli, shallot, garlic and a small piece of belacan.',
      'Fry the paste in oil until fragrant and darkened, about five minutes.',
      'Day-old rice in, press it flat, let it catch before you toss it.',
      'Push aside, scramble the eggs in the gap, fold through. Cucumber on the side to cool it down.',
    ],
  },
  {
    id: 'ayam-pongteh', name: 'Ayam pongteh', cuisine: 'Peranakan', search: 'ayam pongteh nyonya', minutes: 60, serves: 4,
    blurb: 'Chicken braised in fermented bean paste. Better the next day.',
    needs: [CHICKEN, POTATO, SHALLOT, GARLIC, PALM_SUGAR, SOY, OIL, ing('Taucheo', ['taucheo', 'fermented bean paste', 'miso'])],
    tags: [],
    steps: [
      'Blend the shallots and garlic to a paste. Fry it slowly in oil until sweet and golden.',
      'Taucheo in, fry another minute so it loses its raw edge.',
      'Chicken in to coat, then water to cover, palm sugar and dark soy.',
      'Simmer forty minutes. Potatoes in for the last twenty so they thicken the gravy as they soften.',
    ],
  },
  {
    id: 'laksa-quick', name: 'Weeknight laksa', cuisine: 'Peranakan', search: 'nyonya laksa', minutes: 35, serves: 2,
    blurb: 'A short-cut version that still tastes like the real thing.',
    needs: [RICE_NOODLES, COCONUT, PRAWNS, CHILLI, SHALLOT, LEMONGRASS, TURMERIC, BELACAN, CANDLENUT, GALANGAL, LAKSA_LEAF, BEANSPROUTS, EGGS],
    tags: [],
    steps: [
      'Blend chilli, shallot, lemongrass, turmeric, candlenut, galangal and belacan into a rempah.',
      'Fry the rempah in oil until the oil separates — this is the whole flavour, give it ten minutes.',
      'Prawn shells in for a minute if you have them, then water, then coconut milk. Simmer, do not boil hard.',
      'Prawns in for three minutes. Noodles and beansprouts in the bowl, soup over, halved egg and laksa leaf on top.',
    ],
  },
  {
    id: 'assam-fish', name: 'Assam fish', cuisine: 'Peranakan', search: 'assam pedas fish', minutes: 30, serves: 3,
    blurb: 'Sour, hot, and cuts through a heavy day.',
    needs: [ing('Fish', ['fish', 'fish fillet', 'snapper', 'mackerel']), TAMARIND, CHILLI, SHALLOT, BELACAN, LEMONGRASS, TURMERIC, TOMATO, SUGAR],
    tags: [],
    steps: [
      'Rempah first: chilli, shallot, belacan, lemongrass, turmeric, blended and fried until the oil comes out.',
      'Tamarind water in, plus enough water to make a gravy. Simmer ten minutes so it stops tasting raw.',
      'Tomatoes in, then the fish. Do not stir once the fish is in — shake the pan instead.',
      'Eight minutes, covered. Balance sour, salt and a little sugar at the end.',
    ],
  },
  {
    id: 'chap-chye', name: 'Chap chye', cuisine: 'Peranakan', search: 'nyonya chap chye', minutes: 40, serves: 4,
    blurb: 'The braised cabbage dish that turns up at every Peranakan table.',
    needs: [CABBAGE, CARROT, TOFU, DRIED_SHRIMP, GARLIC, SHALLOT, SOY, ing('Taucheo', ['taucheo', 'fermented bean paste', 'miso']), ing('Glass noodles', ['glass noodles', 'tang hoon', 'vermicelli'], { optional: true })],
    tags: ['vegetarian-ish'],
    steps: [
      'Soften the dried shrimp in water; keep the water, it is the stock.',
      'Shallot and garlic in oil, taucheo in, one minute.',
      'Cabbage and carrot in, coat them, then the soaking water. Cover and let it collapse — twenty minutes.',
      'Tofu and glass noodles in at the end to soak up what is left. It should be wet, not soupy.',
    ],
  },
  {
    id: 'sambal-kangkong', name: 'Sambal green vegetable', cuisine: 'Peranakan', search: 'sambal kangkong', minutes: 12, serves: 2,
    blurb: 'Ninety seconds of cooking, once the paste is made.',
    needs: [CHOY, CHILLI, SHALLOT, GARLIC, BELACAN, OIL, DRIED_SHRIMP],
    tags: ['quick', 'one-pan'],
    steps: [
      'Blend chilli, shallot, garlic, belacan and dried shrimp.',
      'Fry the paste hard in oil until it darkens and smells of the hawker centre.',
      'Greens in, toss for ninety seconds — they should still squeak.',
      'Off the heat immediately or they go grey and sad.',
    ],
  },

  {
    id: 'curry-kapitan', name: 'Curry kapitan', cuisine: 'Peranakan', search: 'kapitan curry nyonya', minutes: 50, serves: 4,
    blurb: 'The Nyonya chicken curry — lighter and sharper than the Indian ones.',
    needs: [CHICKEN, COCONUT, CURRY_POWDER, SHALLOT, GARLIC, LEMONGRASS, TURMERIC, CANDLENUT, KAFFIR, LIME, TAMARIND, OIL],
    tags: [],
    steps: [
      'Blend shallot, garlic, lemongrass, turmeric and candlenut into a rempah.',
      'Fry it in oil on a low flame until it darkens and the oil splits out. Curry powder in for the last minute.',
      'Chicken in to coat and colour, then coconut milk and the lime leaves.',
      'Simmer uncovered thirty minutes. Tamarind and a squeeze of lime right at the end — it should finish sour, not sweet.',
    ],
  },

  /* ---------------- Chinese ---------------- */
  {
    id: 'smashed-cucumber', name: 'Smashed cucumber', cuisine: 'Chinese', search: 'chinese smashed cucumber salad', minutes: 10, serves: 2,
    blurb: 'Five minutes, no cooking, and it rescues a heavy meal.',
    needs: [CUCUMBER, GARLIC, VINEGAR, SESAME, SOY, CHILLI_OPT, SUGAR, SESAME_SEEDS],
    tags: ['quick', 'vegetarian', 'no-cook'],
    steps: [
      'Smash the cucumber with the flat of a knife until it splits, then tear it into rough pieces. Torn edges hold dressing; sliced ones do not.',
      'Salt it and leave it in a colander ten minutes, then pour away the water that comes out.',
      'Dress with crushed garlic, vinegar, a little soy, sesame oil, sugar and chilli.',
      'Sesame seeds over. Eat it soon — it goes limp within the hour.',
    ],
  },
  {
    id: 'egg-fried-rice', name: 'Egg fried rice', cuisine: 'Chinese', search: 'egg fried rice', minutes: 15, serves: 2,
    blurb: 'The one that exists because there is leftover rice.',
    needs: [RICE, EGGS, OIL, SOY, SPRING, GARLIC],
    tags: ['quick', 'one-pan', 'vegetarian'],
    steps: [
      'Day-old rice works far better than fresh — the grains stay separate.',
      'Beat the eggs. Get the pan hotter than feels sensible, oil in, eggs in, scramble and lift out while still soft.',
      'Garlic for ten seconds, then the rice. Press it flat and leave it alone so it toasts.',
      'Eggs back, soy round the edge of the pan rather than over the rice, toss, spring onion, off the heat.',
    ],
  },
  {
    id: 'tomato-egg', name: 'Tomato and egg', cuisine: 'Chinese', search: 'chinese tomato and egg stir fry', minutes: 12, serves: 2,
    blurb: 'What everyone actually cooks at home. Four ingredients.',
    needs: [TOMATO, EGGS, SPRING, SUGAR, OIL, RICE],
    tags: ['quick', 'one-pan', 'vegetarian'],
    steps: [
      'Beat the eggs with a pinch of salt. Scramble them in hot oil until just set, lift out.',
      'Tomato wedges into the same pan, a pinch of sugar, and let them break down into a sauce.',
      'Eggs back in, fold through so they soak up the tomato without turning to rubber.',
      'Spring onion, and rice underneath.',
    ],
  },
  {
    id: 'fried-eggs-rice', name: 'Fried egg over rice', cuisine: 'Chinese', search: 'fried egg over rice', minutes: 8, serves: 1,
    blurb: 'When cooking is not really on the table.',
    needs: [RICE, EGGS, SOY, OIL, CHILLI_OPT],
    tags: ['quick', 'vegetarian', 'one-pan'],
    steps: [
      'Hot oil, egg in, spoon the oil over the white until the edges frill and crisp.',
      'Onto hot rice, yolk still running.',
      'Soy over the top, chilli if you want it.',
    ],
  },
  {
    id: 'egg-drop-soup', name: 'Egg drop soup', cuisine: 'Chinese', search: 'egg drop soup', minutes: 12, serves: 2,
    blurb: 'Five minutes and a stock cube.',
    needs: [EGGS, STOCK, GINGER, SPRING, SOY, CORNFLOUR],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Stock and a slice of ginger up to a bare simmer. Thicken very slightly with cornflour if you like it silkier.',
      'Beat the eggs. Take the pan off the boil, stir the soup into a slow spiral and pour the egg in a thin stream.',
      'Leave it ten seconds before stirring, or you get scrambled egg soup.',
      'Soy to season, spring onion over.',
    ],
  },
  {
    id: 'garlic-greens', name: 'Garlic oyster sauce greens', cuisine: 'Chinese', search: 'chinese greens in oyster sauce', minutes: 10, serves: 2,
    blurb: 'The side dish that makes a plain dinner look composed.',
    needs: [CHOY, GARLIC, OYSTER, OIL, SESAME],
    tags: ['quick', 'one-pan', 'vegetarian'],
    steps: [
      'Blanch the greens ninety seconds in boiling salted water, drain hard.',
      'Sliced garlic in hot oil until pale gold.',
      'Oyster sauce with a splash of water, bubble for a moment, pour over the greens.',
      'A few drops of sesame oil at the end.',
    ],
  },
  {
    id: 'mapo-tofu', name: 'Mapo tofu', cuisine: 'Chinese', search: 'mapo tofu', minutes: 25, serves: 3,
    blurb: 'Numbing, hot, and mostly storecupboard.',
    needs: [TOFU, PORK, ing('Doubanjiang', ['doubanjiang', 'chilli bean paste', 'chilli paste']), GARLIC, GINGER, SPRING, CORNFLOUR, RICE, SOY],
    tags: ['one-pan'],
    steps: [
      'Cube the tofu and leave it in hot salted water while you cook — it firms up and stops breaking.',
      'Brown the pork hard. Doubanjiang in, fry until the oil turns red.',
      'Garlic and ginger, then stock or water. Simmer five minutes.',
      'Tofu in, drained, and shake rather than stir. Thicken with cornflour slurry in two goes. Spring onion over.',
    ],
  },
  {
    id: 'soy-braised-chicken', name: 'Soy braised chicken', cuisine: 'Chinese', search: 'chinese soy sauce braised chicken', minutes: 45, serves: 4,
    blurb: 'One pot, and the sauce is the point.',
    needs: [CHICKEN, SOY, DARK_SOY, GINGER, GARLIC, SUGAR, SHAOXING, SPRING, RICE],
    tags: ['one-pan'],
    steps: [
      'Brown the chicken skin-side down in a dry pan until the fat renders and the skin is properly gold.',
      'Ginger and garlic in, thirty seconds.',
      'Shaoxing, both soys, sugar and enough water to come halfway up. Lid on.',
      'Thirty minutes, turning once. Lid off for the last ten so the sauce reduces to a glaze.',
    ],
  },
  {
    id: 'chow-mein', name: 'Chow mein', cuisine: 'Chinese', search: 'chow mein', minutes: 20, serves: 2,
    blurb: 'The fridge-clearing noodle dish.',
    needs: [NOODLES, CABBAGE, CARROT, GARLIC, SOY, OYSTER, SESAME, EGGS, SPRING],
    tags: ['quick', 'one-pan'],
    steps: [
      'Boil the noodles a minute short, drain, toss in a little oil so they do not weld together.',
      'Hardest vegetables first into a very hot pan, keep everything moving.',
      'Noodles in, then the sauces down the side of the pan so they sizzle rather than steam.',
      'Push aside, scramble an egg in the gap, fold through, sesame oil off the heat.',
    ],
  },

  /* ---------------- Japanese ---------------- */
  {
    id: 'tamago-kake-gohan', name: 'Tamago kake gohan', cuisine: 'Japanese', search: 'tamago kake gohan', minutes: 5, serves: 1,
    blurb: 'Raw egg over hot rice. Two ingredients, and it is genuinely lovely.',
    needs: [RICE, EGGS, SOY, SPRING, NORI],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Rice as hot as it comes out of the cooker, into a bowl.',
      'Crack the egg straight on and beat it into the rice with chopsticks — the heat is what cooks it.',
      'A small splash of soy, spring onion and torn nori.',
    ],
  },
  {
    id: 'miso-soup', name: 'Miso soup', cuisine: 'Japanese', search: 'miso soup', minutes: 10, serves: 2,
    blurb: 'Ten minutes, and it makes anything else look like a meal.',
    needs: [MISO, TOFU, DASHI, SPRING, NORI],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Dashi up to a bare simmer — or water and a piece of kombu if that is what you have.',
      'Cubed tofu in for two minutes.',
      'Take it OFF the heat, then whisk the miso in through a ladle. Boiling miso kills it.',
      'Spring onion and seaweed in the bowl.',
    ],
  },
  {
    id: 'oyakodon', name: 'Oyakodon', cuisine: 'Japanese', search: 'oyakodon', minutes: 20, serves: 2,
    blurb: 'Chicken and egg over rice, in one small pan.',
    needs: [CHICKEN, EGGS, ONION, SOY, MIRIN, DASHI, RICE, SPRING, SAKE],
    tags: ['one-pan'],
    steps: [
      'Sliced onion, soy, mirin, sake and dashi into a small shallow pan. Simmer until the onion softens.',
      'Chicken in, spread out, five minutes.',
      'Beaten egg poured over in a spiral — do not stir it in.',
      'Lid on, thirty seconds, off the heat while the egg is still barely set. Slide onto rice.',
    ],
  },
  {
    id: 'katsu', name: 'Chicken katsu', cuisine: 'Japanese', search: 'chicken katsu', minutes: 30, serves: 2,
    blurb: 'Worth it for the noise it makes.',
    needs: [CHICKEN, PANKO, EGGS, FLOUR, CABBAGE, RICE, OIL],
    tags: [],
    steps: [
      'Flatten the chicken to an even thickness so it cooks through before the crumb burns.',
      'Flour, then beaten egg, then panko, pressing it on firmly.',
      'Shallow fry in a centimetre of oil, three or four minutes a side, until deep gold.',
      'Rest it on a rack, not paper. Shredded raw cabbage and rice alongside.',
    ],
  },
  {
    id: 'gyudon', name: 'Beef and onion donburi', cuisine: 'Japanese', search: 'gyudon', minutes: 20, serves: 2,
    blurb: 'Sweet-salty beef over rice, twenty minutes flat.',
    needs: [ing('Beef', ['beef', 'sliced beef', 'steak']), ONION, SOY, MIRIN, SUGAR, GINGER, RICE, SPRING, SAKE],
    tags: ['quick', 'one-pan'],
    steps: [
      'Onion, soy, mirin, sake, sugar and a little water into a wide pan. Simmer until the onion is translucent.',
      'Very thinly sliced beef in, separated as it goes.',
      'Three minutes, no more — it toughens fast.',
      'Over rice, with the broth spooned on, spring onion over.',
    ],
  },
  {
    id: 'agedashi-tofu', name: 'Agedashi tofu', cuisine: 'Japanese', search: 'agedashi tofu', minutes: 25, serves: 2,
    blurb: 'Crisp outside, custard inside.',
    needs: [TOFU, CORNFLOUR, DASHI, SOY, MIRIN, GINGER, SPRING, OIL],
    tags: ['vegetarian'],
    steps: [
      'Press the tofu properly — thirty minutes under a plate. Wet tofu spits and never crisps.',
      'Cube it, coat in cornflour, fry until pale gold on all sides.',
      'Warm dashi, soy and mirin together into a light broth.',
      'Tofu in a bowl, broth poured around it rather than over, grated ginger and spring onion on top.',
    ],
  },
  {
    id: 'yaki-udon', name: 'Yaki udon', cuisine: 'Japanese', search: 'yaki udon', minutes: 15, serves: 2,
    blurb: 'Fatter noodles, faster dinner.',
    needs: [ing('Udon', ['udon', 'noodles', 'thick noodles']), CABBAGE, ONION, SOY, MIRIN, OYSTER, SESAME_SEEDS, SPRING],
    tags: ['quick', 'one-pan'],
    steps: [
      'Loosen the udon in hot water for a minute, drain.',
      'Onion and cabbage in a very hot pan until they take some colour.',
      'Noodles in, then soy, mirin and oyster sauce. Toss until everything is glossy.',
      'Sesame seeds and spring onion.',
    ],
  },

  /* ---------------- Italian ---------------- */
  {
    id: 'aglio-e-olio', name: 'Spaghetti aglio e olio', cuisine: 'Italian', search: 'spaghetti aglio e olio', minutes: 15, serves: 2,
    blurb: 'Four things. Gets ruined by rushing the garlic.',
    needs: [PASTA, GARLIC, OLIVE_OIL, CHILLI_OPT, SALT, PARMESAN_OPT],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Pasta into water as salty as a good soup. Keep a mug of it before draining.',
      'Sliced garlic into COLD oil, then low heat. Let it turn the palest gold over several minutes.',
      'Chilli in at the end for thirty seconds.',
      'Drained pasta in with a good splash of the cooking water, toss hard until the oil and water turn creamy.',
    ],
  },
  {
    id: 'cacio-e-pepe', name: 'Cacio e pepe', cuisine: 'Italian', search: 'cacio e pepe', minutes: 15, serves: 2,
    blurb: 'Cheese, pepper, pasta water. Technique, not ingredients.',
    needs: [PASTA, PARMESAN, PEPPER, SALT],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Toast a heaped teaspoon of cracked pepper in a dry pan until it smells of pepper rather than dust.',
      'Cook the pasta in less water than usual so the water is starchier.',
      'Mix the grated cheese with a little warm pasta water into a paste OFF the heat.',
      'Pasta and pepper into the paste, tossing, adding water until it coats. Heat is what makes it split — keep the pan off it.',
    ],
  },
  {
    id: 'carbonara', name: 'Carbonara', cuisine: 'Italian', search: 'spaghetti carbonara', minutes: 20, serves: 2,
    blurb: 'No cream. It never had cream.',
    needs: [PASTA, EGGS, PANCETTA, PARMESAN, PEPPER],
    tags: [],
    steps: [
      'Render the pancetta slowly from a cold pan so the fat comes out and the meat crisps.',
      'Beat whole eggs and yolks with a lot of grated cheese and pepper into a paste.',
      'Drained pasta into the pancetta pan, OFF the heat, tossed in the fat.',
      'Egg mixture in, tossing constantly, loosening with pasta water. If the pan is on the heat you are making an omelette.',
    ],
  },
  {
    id: 'pasta-pomodoro', name: 'Pasta pomodoro', cuisine: 'Italian', search: 'pasta al pomodoro', minutes: 30, serves: 2,
    blurb: 'A tin of tomatoes, treated with respect.',
    needs: [PASTA, TOMATO, GARLIC, OLIVE_OIL, BASIL, PARMESAN, SALT],
    tags: ['vegetarian'],
    steps: [
      'Whole garlic cloves gently in olive oil until fragrant, then fish them out or crush them in.',
      'Tomatoes in, crushed by hand. Simmer twenty minutes — it should darken and thicken, not stay bright red.',
      'Season properly and much later than you think.',
      'Pasta finished in the sauce, basil torn in off the heat, cheese at the table.',
    ],
  },
  {
    id: 'risotto-bianco', name: 'Risotto bianco', cuisine: 'Italian', search: 'risotto bianco', minutes: 35, serves: 2,
    blurb: 'The base every other risotto is built on.',
    needs: [ARBORIO, ONION, BUTTER, PARMESAN, STOCK_OPT, WHITE_WINE, OLIVE_OIL],
    tags: ['vegetarian'],
    steps: [
      'Onion very finely diced, softened in butter and oil without colouring. Ten minutes.',
      'Rice in, stirred until the grains look translucent at the edges. Wine in, let it disappear.',
      'Hot stock a ladle at a time, stirring, only adding more when the last is nearly gone. Eighteen minutes.',
      'Off the heat, cold butter and cheese beaten in hard. Rest two minutes — it should spread slowly on the plate.',
    ],
  },
  {
    id: 'puttanesca', name: 'Puttanesca', cuisine: 'Italian', search: 'spaghetti alla puttanesca', minutes: 25, serves: 2,
    blurb: 'Salty, sharp, and entirely from tins and jars.',
    needs: [PASTA, TOMATO, ANCHOVY, GARLIC, CHILLI_OPT, OLIVE_OIL, ing('Olives', ['olives', 'capers'], { optional: true })],
    tags: ['storecupboard'],
    steps: [
      'Anchovies into warm oil with the garlic and let them melt completely — they stop being fish and become salt.',
      'Chilli, then tomatoes. Simmer fifteen minutes.',
      'Olives and capers late so they stay punchy.',
      'Toss with the pasta and a little of its water. It will not need salt.',
    ],
  },
  {
    id: 'pasta-fagioli', name: 'Pasta e fagioli', cuisine: 'Italian', search: 'pasta e fagioli', minutes: 30, serves: 3,
    blurb: 'Beans and pasta. Peasant food, and better than most restaurant food.',
    needs: [PASTA, CANNELLINI, TOMATO, GARLIC, ONION, OLIVE_OIL, PARMESAN, ing('Rosemary', ['rosemary'], { optional: true })],
    tags: ['vegetarian', 'storecupboard'],
    steps: [
      'Onion and garlic softened slowly in a good amount of olive oil.',
      'Half the beans in whole, half crushed — the crushed ones thicken it.',
      'Tomato and water in, simmer fifteen minutes with the rosemary.',
      'Small pasta cooked straight in the soup so the starch stays. It should be thick enough to stand a spoon in.',
    ],
  },
  {
    id: 'caprese-eggs', name: 'Eggs in tomato with mozzarella', cuisine: 'Italian', search: 'eggs in purgatory', minutes: 20, serves: 2,
    blurb: 'Breakfast that behaves like dinner.',
    needs: [EGGS, TOMATO, MOZZARELLA, GARLIC, OLIVE_OIL, BASIL, BREAD],
    tags: ['one-pan', 'vegetarian'],
    steps: [
      'Garlic in olive oil, tomatoes in, simmer down to a thick sauce and season it hard.',
      'Make wells and crack the eggs in. Torn mozzarella around them.',
      'Lid on, low heat, until the whites are set and the yolks are not.',
      'Basil, and bread for the bottom of the pan.',
    ],
  },

  /* ---------------- French ---------------- */
  {
    id: 'french-omelette', name: 'French omelette', cuisine: 'French', search: 'french omelette', minutes: 8, serves: 1,
    blurb: 'Pale, rolled, and slightly underdone. The hardest easy thing.',
    needs: [EGGS, BUTTER, SALT, GRUYERE],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Beat three eggs thoroughly with salt — no milk, no water.',
      'Foaming butter in a non-stick pan on medium. Eggs in, then stir constantly with a fork while shaking the pan.',
      'When it is the texture of loose curds, stop. Spread it flat, cheese down the middle.',
      'Roll it out of the pan onto the plate. It should be blonde, not brown, and just barely set.',
    ],
  },
  {
    id: 'croque-monsieur', name: 'Croque monsieur', cuisine: 'French', search: 'croque monsieur', minutes: 25, serves: 2,
    blurb: 'A cheese toastie that went to finishing school.',
    needs: [BREAD, HAM, GRUYERE, BUTTER, FLOUR, MILK, DIJON, PEPPER],
    tags: [],
    steps: [
      'Make a thick béchamel: butter and flour cooked two minutes, milk in slowly, whisked until it coats a spoon. Dijon and pepper in.',
      'Butter the bread on the outside. Ham and cheese inside, a smear of béchamel too.',
      'Fry both sides in butter until deep gold.',
      'The rest of the béchamel over the top with more cheese, then under a hot grill until it blisters.',
    ],
  },
  {
    id: 'soupe-oignon', name: 'Onion soup', cuisine: 'French', search: 'french onion soup', minutes: 75, serves: 4,
    blurb: 'Almost entirely onions. The hour is not optional.',
    needs: [ONION, BUTTER, STOCK, BREAD, GRUYERE, THYME, WHITE_WINE, FLOUR],
    tags: [],
    steps: [
      'Slice a lot of onions thinly. Butter, low heat, lid on for fifteen minutes to sweat them.',
      'Lid off, and now the real work: forty-five minutes of occasional stirring until they are dark, jammy and sweet. Any less and it will taste thin.',
      'A spoon of flour, then wine to deglaze, then stock and thyme. Twenty minutes.',
      'Toasted bread on top, cheese over, under the grill until it bubbles.',
    ],
  },
  {
    id: 'gratin-dauphinois', name: 'Potato gratin', cuisine: 'French', search: 'gratin dauphinois', minutes: 75, serves: 4,
    blurb: 'Potatoes, cream, garlic. Nothing else, and nothing else needed.',
    needs: [POTATO, CREAM, GARLIC, BUTTER, SALT, GRUYERE, ing('Nutmeg', ['nutmeg'], { optional: true })],
    tags: ['vegetarian'],
    steps: [
      'Rub the dish with a cut garlic clove and butter it well.',
      'Slice the potatoes thin — a mandoline if you have one. Do NOT rinse them; the starch is what thickens it.',
      'Layer with cream, salt and a scrape of nutmeg between each layer.',
      'Covered for forty minutes, uncovered with cheese for twenty more, until a knife slides straight through.',
    ],
  },
  {
    id: 'poulet-moutarde', name: 'Mustard chicken', cuisine: 'French', search: 'french mustard chicken', minutes: 40, serves: 3,
    blurb: 'One pan, and the sauce makes itself.',
    needs: [CHICKEN, DIJON, CREAM, ONION, GARLIC, WHITE_WINE, THYME, BUTTER],
    tags: ['one-pan'],
    steps: [
      'Brown the chicken properly on both sides and lift it out. The brown bits in the pan are the sauce.',
      'Onion and garlic into the same pan, softened in the fat.',
      'Wine in to lift everything off the base, reduce by half.',
      'Cream and a heaped spoon of mustard in, chicken back, twenty minutes at a bare simmer. Do not boil it or the sauce splits.',
    ],
  },
  {
    id: 'lentilles', name: 'Lentils with mustard and thyme', cuisine: 'French', search: 'french puy lentils with mustard', minutes: 40, serves: 3,
    blurb: 'Cheap, meatless, and quietly excellent.',
    needs: [LENTILS, CARROT, ONION, GARLIC, DIJON, THYME, VINEGAR_W, OLIVE_OIL],
    tags: ['vegetarian'],
    steps: [
      'Finely dice carrot, onion and garlic and sweat them slowly in olive oil until sweet.',
      'Lentils in, water to cover by two fingers, thyme. Simmer twenty-five minutes — salt only near the end or the skins toughen.',
      'Whisk mustard and vinegar together and stir it through off the heat.',
      'It should be loose, not soupy. Good with an egg on top.',
    ],
  },
  {
    id: 'oeufs-cocotte', name: 'Baked eggs with cream', cuisine: 'French', search: 'oeufs en cocotte', minutes: 20, serves: 2,
    blurb: 'Eggs, cream, an oven, ten minutes of attention.',
    needs: [EGGS, CREAM, BUTTER, GRUYERE, BREAD, THYME],
    tags: ['quick', 'vegetarian'],
    steps: [
      'Butter two ramekins. A spoon of cream in the bottom of each.',
      'Crack an egg into each, another spoon of cream over, cheese and thyme on top.',
      'Into a roasting tin, boiling water halfway up the sides, into a hot oven.',
      'Twelve minutes — whites set, yolks liquid. Toast cut into soldiers.',
    ],
  },
  {
    id: 'sauce-tomate-francaise', name: 'Steak with pan sauce', cuisine: 'French', search: 'steak with pan sauce', minutes: 20, serves: 2,
    blurb: 'The sauce takes three minutes and changes everything.',
    needs: [ing('Steak', ['steak', 'beef']), BUTTER, SHALLOT, DIJON, CREAM, WHITE_WINE, PEPPER, SALT],
    tags: ['quick', 'one-pan'],
    steps: [
      'Steak dry, salted hard, into a very hot pan. Do not move it.',
      'Rest it somewhere warm — this is not optional, it is half the result.',
      'Shallot into the same pan, wine in to deglaze, reduced almost away.',
      'Cream and mustard in, bubbled for a minute, cold butter beaten in off the heat. Resting juices back into the sauce.',
    ],
  },
]
/**
 * Where to go and watch someone make it.
 *
 * A SEARCH, deliberately, not a hand-picked video. Curating forty specific
 * links means either inventing them — which produces confident 404s — or
 * verifying them and then re-verifying forever as channels delete things. A
 * search URL cannot rot, and it improves over time rather than decaying. It is
 * also the honest shape of the answer: nobody here has watched these videos.
 */
export function videoQuery(r: Recipe): string {
  return `${r.search ?? r.name} recipe`
}

export function youtubeSearchUrl(r: Recipe): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(videoQuery(r))}`
}

export function webSearchUrl(r: Recipe): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(videoQuery(r))}`
}

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
  const tags: string[] = []

  for (const i of items) {
    if (i.archived) continue
    const words = [i.name, i.brand, ...(i.tags ?? []), i.notes]
      .filter(Boolean).map(w => norm(w as string)).filter(Boolean)
    ;(i.qty > 0 ? have : out).push(...words)
  }
  for (const c of locationContents) {
    const n = norm(c)
    if (n) tags.push(n)
  }

  // Two items of the same thing, one empty and one not, means you have some.
  const haveSet = new Set(have)
  return {
    have: [...haveSet],
    out: [...new Set(out)].filter(o => !haveSet.has(o)),
    tags: [...new Set(tags)],
  }
}
