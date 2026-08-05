# CasaaHome

A home inventory PWA: where everything lives, what is running out, and a weekly
Telegram list telling you what to buy and where to buy it.

- **Where is it** — nested places (room → cabinet → shelf → box), photos, one search box
- **How much is left** — correct the count to reality in one tap; the app learns the burn rate
- **What to buy** — auto shopping list split into a Singapore run, a JB run, and Shopee
- **What to use up** — expiry warnings, plus nudges about things forgotten in storage
- **The house** — trace your 2D floorplan once; orbit the 3D doll's-house cutaway and tap a cupboard to see inside

Stack: React + Vite + Three.js PWA on GitHub Pages · Firestore + Cloud Storage ·
Telegram via a scheduled GitHub Action.

---

## Live

**App:** <https://casaahome.web.app> — use this one.
**Mirror:** <https://xynkro.github.io/CasaaHome/>
**Bot:** [@LVHome1646Bot](https://t.me/LVHome1646Bot)

Both serve the same build. Prefer `casaahome.web.app`: it is the same origin as the
Firebase auth domain, so Google sign-in never touches cross-site storage. On the
GitHub Pages mirror the login *is* cross-site, and browsers that partition or block
third-party storage — private windows, in-app browsers, strict tracking-prevention
settings — can refuse it. The app now falls back from popup to redirect and degrades
its session persistence rather than failing outright, but same-origin simply avoids
the problem.

Deploy the mirror: push to `main`. Deploy the primary: `npm run deploy:hosting`.

## Setup — what is already done

- Firebase project `casaahome` created, Firestore in `asia-southeast1`, rules deployed
- Household allowlist seeded with `the.disruptive.comp@gmail.com`
- GitHub Pages deploying from Actions on every push to `main`
- Repo secrets `TELEGRAM_BOT_TOKEN` and `FIREBASE_SERVICE_ACCOUNT` set, and the
  notifier verified end to end with a dry run
- Household name set to **Casaa**, members: Caspar (two addresses) and Sarah
- Blaze enabled; Cloud Storage bucket provisioned in `asia-southeast1` and rules
  deployed, verified with `node scripts/rules.test.mjs`
- The 1:100 floor plan from the Monocot drawing set is loaded as a scale-calibrated
  tracing backdrop (see below)

## Setup — what still needs you

### 1. Turn on Google sign-in — required, nothing works without it

Firebase mints the OAuth client for you, but only from the console.

1. <https://console.firebase.google.com/project/casaahome/authentication/providers>
2. **Get started** → **Google** → **Enable** → pick a support email → **Save**
3. **Settings → Authorised domains** → **Add domain** → `xynkro.github.io`

### 2. Point the bot at you

Open [@LVHome1646Bot](https://t.me/LVHome1646Bot) and send it anything — a bot cannot
message you first. Then read your numeric chat ID from
`https://api.telegram.org/bot<TOKEN>/getUpdates` and paste it into
**Settings → Telegram → Chat ID** in the app.

### 3. Add Sarah

**Settings → Who can get in** → her Google address. Then add the same address to the
list in `storage.rules` and run `npm run rules:deploy`, or her photo uploads will be
refused — Storage rules cannot read Firestore, so that list is duplicated on purpose.

## How it decides things

**"Low" is two rules, whichever fires first.** Below the item's own minimum, or —
once there is enough history to estimate a rate — under `lowCoverDays` of stock
left at the observed rate of use.

**Burn rate comes from corrections, not from logging.** Nobody reliably records
every use. What people do is open a cupboard, find two where the app said ten, and
fix it. Every such correction is treated as consumption that simply had not been
reported yet, and the rate is derived from total observed decrease over the whole
window. Restocks are excluded so buying more never looks like using more.

**Store routing.** Prices are whatever you have recorded — none of these retailers
publish a usable price API, so the app never pretends to know a live price. With two
or more prices on an item it routes to the cheapest, normalising MYR to SGD. With
none, it falls back to a per-category default. Shopee always gets a working deep link
(a search, or the direct product URL once you paste one in).

**Shopee sale timing.** Shopee runs campaigns on the double dates — 1.1, 2.2 … 12.12 —
open the day either side. The digest names the next one, and holds back anything merely
*low* until it arrives (default: if it is within 10 days). Anything you have actually run
out of is bought now, because running out beats saving a dollar. When a window is live the
digest says so at the top.

**Shopee versus the shops.** Online and in-store are separate sections, and any line with
two or more recorded prices shows the comparison inline — `Shopee $4.20 vs NTUC $5.90 →
saves ~$1.70` — so the routing is auditable rather than magic.

**Per-item alerting.** Each item is *normal* (weekly digest), *urgent* (pinged the day it
goes low) or *never* (kept out of Telegram entirely). Spare screws do not need announcing.

**The JB rule.** A JB run costs petrol, tolls and a queue. If the JB basket is under
`jbMinBasketSgd`, those items are folded back into the Singapore list instead and the
digest says so.

**Storage nudges skip seasonal things.** Only places ticked *long-term storage* are
nagged, and any item ticked *seasonal* is exempt — winter clothes going untouched
for a year is correct behaviour, not a problem.

## Telegram schedule

The notifier runs hourly and usually sends nothing. It sends when:

- the weekly digest day arrives (configurable, default Thursday, after 08:00 SGT) —
  header, then one message per trip, then a use-it-up message
- something has newly hit zero (at most one such alert a day, 08:00–21:00 SGT)
- you tapped **Ask the bot to send it** on the Shopping tab, or **Send via bot** on an item
  (an item page also has **Share now**, which opens Telegram with the text ready and needs
  no bot at all)

Preview without sending anything: **Actions → Telegram notifier → Run workflow →
dry run ✓**, or locally:

```bash
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" npm run notify:dry
```

## The floorplan backdrop

`house/plan` carries the proposed floor plan from the architect's PDF as an inline
data URL, rendered at 8.819 mm per pixel. That figure is not estimated: the drawing's
own dimension chain measures 1501 / 1770 / 3289 mm against a printed 1500 / 1770 /
3288, so the 1:100 ratio is confirmed to better than 0.1%. Anything traced on this
backdrop is dimensionally correct.

Walls are **not** auto-extracted. It was tried: isolating the heaviest line weight
picks up only the new partitions, and widening the filter starts pulling in the
dining table, the bed and the dimension lines. Walls and furniture share line weights
in this set and the PDF carries no layer data, so extraction is not reliable and the
result would look right while being wrong. Trace it in the editor instead.

## The 3D view

The doll's-house cutaway is generated from the floorplan you trace — walls sliced at
1.25 m so you can see into every room, room floors tinted, and each storage place drawn
as furniture massing sized to its kind. Anything running low gets a coloured bead above
it, so the state of the house reads at a glance. **Cutaway** toggles full-height walls;
on desktop, **Walk through** drops you inside at eye height (WASD, pointer lock).

## Local development

```bash
npm install
npm run dev            # against live Firebase
npm run emu            # in another shell: Firebase emulators
npm run dev:emu        # against the emulators instead
npm test               # logic checks for stock, burn rate, shopping
```

## Layout

```
src/
  types.ts             domain model
  store.ts             zustand + Firestore subscriptions, all mutations
  lib/stock.ts         status, burn rate, days of cover
  lib/shopping.ts      shopping plan, store routing, use-it-up list
  lib/links.ts         retailer deep links, MYR→SGD
  lib/images.ts        client-side downscale + upload
  views/               Dashboard, Search, Places, Shopping, Settings,
                       ItemSheet, VerifySweep, PlanEditor, HouseView (3D)
scripts/notify.ts      Telegram notifier, run by GitHub Actions
```

`lib/` is deliberately free of browser and Firebase imports so the notifier can
import the exact same logic the app uses. There is one definition of "low".
