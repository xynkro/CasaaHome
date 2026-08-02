# CasaaHome

A home inventory PWA: where everything lives, what is running out, and a weekly
Telegram list telling you what to buy and where to buy it.

- **Where is it** — nested places (room → cabinet → shelf → box), photos, one search box
- **How much is left** — correct the count to reality in one tap; the app learns the burn rate
- **What to buy** — auto shopping list split into a Singapore run, a JB run, and Shopee
- **What to use up** — expiry warnings, plus nudges about things forgotten in storage
- **The house** — trace your 2D floorplan once; walk through the 3D model and tap a cupboard to see inside

Stack: React + Vite + Three.js PWA on GitHub Pages · Firestore + Cloud Storage ·
Telegram via a scheduled GitHub Action.

---

## One-time setup

Four things need a human. Everything else is already provisioned.

### 1. Turn on Google sign-in (2 min, required)

Firebase creates the OAuth client for you, but only from the console.

1. Open <https://console.firebase.google.com/project/casaahome/authentication>
2. **Get started** → **Google** → toggle **Enable** → pick a support email → **Save**
3. Go to **Settings → Authorised domains** and add `xynkro.github.io`

### 2. Upgrade the project to Blaze (2 min, required for photos)

Cloud Storage on projects created after Oct 2024 needs a billing account attached.
At this scale it stays inside the free allowances — expect roughly nothing per month,
but set a budget alert if you want a hard stop.

1. <https://console.firebase.google.com/project/casaahome/usage/details> → **Upgrade to Blaze**
2. Then <https://console.firebase.google.com/project/casaahome/storage> → **Get started**
   → pick **asia-southeast1** (same region as Firestore)
3. Back here, push the Storage rules:

```bash
firebase deploy --only storage --project casaahome
```

Until this is done everything works except photo and floorplan upload.

### 3. Create the Telegram bot (3 min)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → name it → copy the token
2. Send your new bot any message (it cannot DM you until you speak first)
3. Get your numeric chat ID — open this in a browser, replacing `<TOKEN>`:
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`
4. Paste that ID into the app under **Settings → Telegram**

### 4. Add the GitHub secrets (3 min)

In **repo → Settings → Secrets and variables → Actions**:

| Name | Type | Value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | the BotFather token |
| `FIREBASE_SERVICE_ACCOUNT` | secret | the whole service-account JSON, pasted raw |
| `APP_URL` | variable | `https://xynkro.github.io/CasaaHome/` |

Get the service account from
<https://console.firebase.google.com/project/casaahome/settings/serviceaccounts/adminsdk>
→ **Generate new private key**. Paste the file contents into the secret; never commit it.

Then enable Pages: **repo → Settings → Pages → Source: GitHub Actions**.

---

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
- you tapped **Ask the bot to send it** on the Shopping tab

Preview without sending anything: **Actions → Telegram notifier → Run workflow →
dry run ✓**, or locally:

```bash
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" npm run notify:dry
```

## Adding your household

**Settings → Who can get in** → add their Google address. The database enforces the
list, not just the app. Storage rules keep their own copy of the list — add the address
in `storage.rules` too and redeploy, or their photo uploads will be refused.

## Local development

```bash
npm install
npm run dev
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
