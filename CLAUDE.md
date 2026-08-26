# CasaaHome — working notes

Home inventory PWA. Read this before changing anything.

## Shape

- **App**: React 19 + Vite + Tailwind v4, hash-routed, PWA.
- **One URL: https://casaahome.web.app** — Firebase Hosting, served from `/`,
  deployed by `.github/workflows/deploy.yml` on every push to main.
  `xynkro.github.io/CasaaHome/` is now only a redirect page that also tears down
  its own old service worker; do not deploy the app there again. There were two
  live sites for a fortnight serving different builds, because Pages deployed
  automatically and Hosting only moved when someone ran a command by hand.
  Hosting won: same-origin with Firebase Auth, no subpath, and it can set
  Cache-Control — **`sw.js` must stay `no-cache`** or an installed PWA can pin
  itself to an old build forever. Pages cannot set headers at all.
- **Data**: Firebase project `casaahome` (Firestore + Storage, `asia-southeast1`).
  The web config in `src/firebase.ts` is public by design; access control is
  entirely in `firestore.rules` / `storage.rules`.
- **Telegram**: `scripts/notify.ts`, run hourly by `.github/workflows/notify.yml`.
  **Not** Cloud Functions — the Action is free, always awake, and keeps the whole
  system in one repo.

## Hard rules

1. **`src/lib/` must stay free of browser and Firebase imports.** `notify.ts`
   imports `lib/stock.ts`, `lib/shopping.ts`, `lib/links.ts` directly so the bot
   and the UI cannot disagree about what "low" means. `lib/images.ts` is the one
   exception and is never imported by the notifier.
2. **Never put the bot token or a service account in the client bundle.** The app
   cannot send Telegram messages itself; it writes `telegram/outbox` and the hourly
   job drains it.
3. **Zustand v5 has no shallow compare.** Select one field per `useStore` call.
   Object-returning selectors loop forever.
4. **Storage rules duplicate the allowlist** because Storage rules cannot read
   Firestore. Adding a household member means editing `config/access` in the app
   *and* `storage.rules` + redeploy.
5. **Correcting a count is the primary interaction**, not logging consumption.
   Keep it one tap from anywhere an item appears.

## Firestore layout

```
items/{id}          Item + history[] (last 40 StockEvents, for burn rate)
locations/{id}      StorageLocation, nests via parentId
house/plan          HousePlan — walls, rooms, plan image, metresPerPixel
config/access       { emails: [] }   the household allowlist
config/settings     Settings
config/telegram     { chatId }
shopping/state      { checked, manual }
events/{id}         append-only activity feed (last 120 read)
telegram/outbox     { status: 'pending' | 'sent' }  manual send request
telegram/state      dedupe state so alerts do not repeat daily
```

## Where things are, spatially

There is **no 3D model and no floorplan editor** — both were removed on
2026-08-07. A traced doll's house told you a cupboard was "in the kitchen",
which you already knew, and cost an evening of tracing to say it.

The replacement is a photograph. `Room.photoUrl` is a wide shot of the room, and
each `StorageLocation.pin` is `{x, y}` as **fractions 0–1 of that image** — never
pixels, so a pin survives the photo being reshot at another size and lands
correctly at any display width. `RoomBoard` draws the dots and does the placing;
the room cards on the dashboard are the way in.

`Room.polygon` and the wall/plan fields still exist on the types so old
documents parse, and nothing reads them.

## Creating documents

`src/lib/records.ts` builds every new item and location: **defaults first, then
the caller's patch spread over the top**, with `undefined` stripped.

It used to be an explicit whitelist inline in the store, which reads as careful
and is a trap. `contents` and `shots` were added to `StorageLocation` for the
camera-first flow and never reached Firestore, so every cupboard Caspar
photographed saved with no photo and no tags — silently, looking exactly like a
save button that did nothing. Adding a field to the type and the form must not
require remembering a third place. `scripts/records.test.ts` guards this.

**`deepDefined` for anything nested.** `defined()` only strips the top level.
Firestore rejects `undefined` ANYWHERE — including inside an object inside an
array — and rejects the WHOLE write. `setQty` built a StockEvent with
`note: undefined` (no caller has ever passed a note), pushed it into
`history[]`, and so every count correction threw before reaching the network.
The callers `await` it inside `try/finally` with no `catch`, so it failed in
total silence — the app's stated primary interaction, broken and invisible.
Anything with an array of objects goes through `deepDefined`.

`defined()` matters as much as the merge: **Firestore rejects a write whose
value is `undefined`**, and an optional field the form left alone is exactly
that, so one untouched field would throw the whole save. Every write path
(`saveItem`, `saveLocation`, `savePlan`, `saveSettings`, `saveShopping`) runs
its patch through it.

## Swipe to delete

`src/ui/SwipeRow.tsx` wraps a list row so it can be swiped left to delete. Two
details are load-bearing and easy to undo by accident:

- **`touch-action: pan-y`** on the moving element hands vertical scrolling back
  to the browser and keeps only the horizontal axis. Drop it and the list
  becomes unscrollable, which is far worse than a buried delete.
- **The row NARROWS, it does not slide.** Pushing the row left is the usual
  trick; it carried short labels like "Bare shelf" clean off the screen and left
  a red Delete button next to nothing. Shrinking keeps the name anchored and
  lets it truncate, so you can still read what you are deleting.

The gesture also refuses to engage until horizontal movement beats vertical —
fingers travel in arcs, and engaging on the first horizontal pixel fires
constantly during an ordinary scroll. A completed swipe swallows the click that
ends it, or swiping a row would also open the thing you were trying to delete.

Deleting a place with contents asks once in a full-width bar, because the
sentence naming what gets unfiled does not fit in a 92pt tab. **Items always
ask**: a place delete unfiles its contents, an item delete loses the thing and
its count history.

`ItemRow` takes swipe as an **opt-in prop, deliberately not a default**. The
same component renders the dashboard's "Needs attention" and "Use these up": a
row is there because something is running LOW, not because it should be deleted,
and a mis-swipe there would destroy the thing you were about to buy. Swiping is
wired only where you are curating what exists — Search, the Places tree, unfiled
items, and inside a cupboard.

## What can we cook

`src/lib/recipes.ts` is a fixed library of 40 recipes plus the matcher, pure and
testable; `src/views/CookView.tsx` is the screen, reachable from a dashboard
card at `/cook`.

**Five cuisines, no sixth**: Peranakan, Chinese, Japanese, Italian, French —
what the household actually cooks. There is deliberately no "other" bucket; a
junk drawer of beans on toast would rank alongside food someone wants to eat.
Each cuisine must keep a **low-barrier way in** (a dish blocked by five or fewer
non-staple ingredients) — Peranakan and French run to twelve ingredients a dish,
and a cuisine whose every entry reads "nine short" is decoration, not a feature.
`scripts/recipes.test.ts` enforces both the floor per cuisine and that an
ordinary kitchen gets within three ingredients of all five.

**Deliberately not generated.** The client bundle must never carry an API key
(hard rule 2), so a model call would have to go through the hourly Action — and
"what can I cook" is asked standing in the kitchen at 7pm, which an hourly job
cannot answer. A fixed library is also testable, and matching is the part that
can be wrong.

Three things the matcher gets right and are easy to break:

- **Cupboard tags count as stock.** Most of this house is photographed and
  tagged rather than itemised, so "#eggs" on the fridge is often the only record
  that there are eggs. Ignore location `contents` and the feature answers "no"
  to everything.
- **Staples are assumed present** unless a tracked item says they ran out.
  Nobody catalogues salt, and blocking on it buries every recipe behind a pantry
  entry nobody will make.
- **Matching is whole-word, not substring** (`mentions`) — and whole-word is
  still not enough. "rice" IS a whole word inside "rice vinegar", "onion" inside
  "spring onion", "chicken" inside "chicken stock". Ingredients therefore carry
  **`not`**, phrases that disqualify a source outright, so a bottle of rice
  vinegar cannot pass for a bag of rice.
- **An ingredient must be satisfiable by its own `name`.** The shopping hand-off
  creates an item called exactly that, so if the name does not match the
  ingredient's own phrases the recipe stays short forever and re-offers it every
  time. CHOY was called "Green vegetable" and matched only choy sum / bok choy /
  kai lan / spinach. A test now asserts this for every ingredient.
- **`norm` folds accents.** Without it "Gruyère" becomes "gruy re" — the
  accented letter is a word break — so the ingredient can never be found and the
  recipe silently claims you lack a cheese sitting in the fridge.
- **Chilli exists twice on purpose** (`CHILLI`, `CHILLI_OPT`). It is the point
  of a sambal and a garnish on a fried egg; one constant cannot be both.

Each recipe links out to **a YouTube search, never a chosen video**
(`youtubeSearchUrl`). Curating forty specific links means either inventing them,
which produces confident 404s, or verifying them and then re-verifying forever
as channels delete things. A search URL cannot rot and improves over time.
`Recipe.search` overrides the query where the card's English title is a poor
search term — "gyudon" finds cooking videos, "beef and onion donburi" mostly
finds translations. The tests assert no link ever encodes `/watch` or `youtu.be`.

Missing ingredients split into `missingTracked` (an item exists at zero, so it
is **already** on the shopping list — offering to add it again just creates a
second "Rice" beside "Jasmine rice 5kg") and `missingUnknown` (no record at all,
worth creating at qty 0 so it flows onto the list through the normal route).

`CookView` waits for `loaded && locationsLoaded` before rendering anything.
Every number on that screen is a claim about what the house has, and an empty
store renders as "you are short of everything", confidently, a moment before it
says something else.

## Gotchas

- Room photos upload to the `locations/` Storage folder, not a `rooms/` one, so
  they need no new Storage rule.
- `estimateBurnPerDay` needs ≥2 events and ≥3 days of span, and ignores restocks.
  Returning `null` is normal and means "not enough evidence yet".
- Icons are generated by a Pillow script; regenerate rather than hand-editing.

## The panorama maths

`src/lib/orientation.ts` and `src/lib/equirect.ts` are the "stand in one spot,
take a dozen photos, stitch them" path Caspar asked for. **Nothing imports them
— there is no capture screen yet**, and the bundle is byte-identical with and
without them, so they cost nothing until something uses them.

They are verified, not merely written: `scripts/pano.test.ts` runs 36 checks
against independently worked ground truth and is part of `npm test`. The plan
for a 65-degree portrait lens is 29 shots and covers the sphere completely;
coverage only breaks once shots are below 0.6x their declared field of view.

Known and deliberate: `suggestTargets` sizes each row from its band edge rather
than its centre, which asks for about **16% more shots than strictly needed** —
row-centre planning also covers fully, even at 10 degrees of aiming error. That
is margin, not necessity. Do not "optimise" it away without re-running the
comparison; equally, do not treat the shot count as a hard minimum.

## Testing on a real iPhone

An installed PWA hands Google sign-in to a system web-auth sheet that lives
outside the app, so nothing can drive it and the Auth emulator's own account
picker is unreachable. Set `VITE_EMULATOR_USER` alongside `VITE_USE_EMULATOR`
and the emulator build signs itself in, which makes the whole app exercisable
on the phone. Production sets neither, so Vite strips the branch.

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="$JAVA_HOME/bin:$PATH" \
  firebase emulators:start --project casaahome --only auth,firestore,storage
VITE_USE_EMULATOR=true VITE_EMULATOR_USER=you@example.com npm run build
npx vite preview --port 5204   # then Add to Home Screen in the simulator
```

The web clip caches aggressively and keeps its own storage container, separate
from Safari's. After a rebuild, serve on a **fresh port** and install again
rather than fighting the old clip's service worker — a wedged clip shows a
blank white screen, which is the cache, not a bug in the app.

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm run seed:emu          # fill the emulator with a believable house
npm run rules:deploy      # CI deploys the app; this is only for rules
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" npm run notify:dry
```
