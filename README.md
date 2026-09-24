# AWCA Lottery

A single page for the Alconbury Weald Community Association lottery. Active subscribers are read live from the Wix site. The prize pot is the number of active subscribers times £1.25. The winner is drawn automatically at 20:00 UK time on the 1st of each month, chosen evenly from the active subscribers. Draw Winner stays as a manual fallback.

## Environment variables

Set these on the Vercel project. Do not put them in the browser, and do not commit `.env`.

| Name | Required | Purpose |
| --- | --- | --- |
| `WIX_API_KEY` | Yes, for live data | Wix API key. Server only. |
| `WIX_SITE_ID` | Yes, for live data | Meta site id for www.alconbury-weald.org. |
| `WIX_LOTTERY_PLAN_ID` | No | Pricing plan id. If empty, the server picks a plan priced 2.50 GBP, preferring a name that contains "lottery". The chosen plan is written to the Vercel function logs. |
| `ADMIN_PASSWORD` | Yes, to view members | Unlocks the member list. Draw Winner is the manual fallback if the 20:00 UK draw did not run. Checked only on the server. |
| `CRON_SECRET` | Yes, for the automatic draw | Vercel sends `Authorization: Bearer` plus this secret to `/api/cron/draw`. The route returns 503 if it is missing. |
| `ENTRY_REF_SECRET` | No | Secret for public entry references. If empty, `ADMIN_PASSWORD` is used. Do not change it after the first draw. |
| `WIX_MOCK` | No | Set to `1` to show obviously fake sample members and skip Wix. Use this on a preview when credentials are not ready. |

If `WIX_API_KEY` or `WIX_SITE_ID` is missing, and mock mode is off, the page shows an error instead of crashing.

The public site response currently includes meta site id `00d28da8-27ea-4fd0-9272-351423f10120`. Confirm it in the Wix dashboard before saving `WIX_SITE_ID`. The dashboard address for the site usually contains the same id.

## Wix API key

Create the key in the Wix account that owns the site (API Keys in account settings). Site level calls have to use a key from that owning account, and the key has to be allowed to access this site.

Give the key these permissions:

- Read Orders, `SCOPE.DC-PAIDPLANS.READ-ORDERS`
- Read Pricing Plans, `SCOPE.DC-PAIDPLANS.READ-PLANS`
- Read Members, `SCOPE.DC-MEMBERS.READ-MEMBERS`
- Read Data Items, `SCOPE.DC-DATA.READ`
- Write Data Items, `SCOPE.DC-DATA.WRITE`
- Manage Data Collections, `SCOPE.DC-DATA.DATA-COLLECTIONS-MANAGE`

The page calls these REST endpoints:

- `POST https://www.wixapis.com/pricing-plans/v3/plans/query` to find the plan
- `GET https://www.wixapis.com/pricing-plans/v2/orders` to list subscribers, including cancelled and ended orders
- `POST https://www.wixapis.com/members/v1/members/query` with the `FULL` fieldset to read member names
- `POST https://www.wixapis.com/wix-data/v2/items/query` and `POST https://www.wixapis.com/wix-data/v2/items` to read and save draws

Headers on every call: `Authorization` set to the API key (not a Bearer token), and `wix-site-id` set to `WIX_SITE_ID`.

## Plan id

In the Wix dashboard, open Pricing Plans and select the £2.50 lottery plan. If the plan id is in the address bar, copy it into `WIX_LOTTERY_PLAN_ID`.

If you leave that variable empty, the server logs a line like `AWCA lottery plan selected: id=... name=... via price 2.50 GBP`. Copy that id into `WIX_LOTTERY_PLAN_ID` once you are happy it is the right plan. Set the variable if more than one plan could match.

Only orders whose status is `ACTIVE` go into the draw, one entry per member. Cancelled, ended, paused, pending, and draft orders stay on the admin list and are not drawn.

## Public winners and entry references

The public page, the public draw history, and `GET /api/state` never include a winner's full name or email. A winner is shown as initials plus an entry reference, for example `D.M. - Entry 4F7A2C`.

Initials come from the first and last name. `Daniel Monks` becomes `D.M.` A single name uses that name's initial. Hyphenated parts each contribute an initial, so `Mary-Jane Watson` becomes `M.J.W.` If no name is available, the public label is the entry reference only.

Wix Pricing Plans orders do not include a short public order number. Order ids are long internal ids, so they are not used. The entry reference is the first 6 hex characters, in capitals, of an HMAC-SHA256 of the Wix member id. The key is `ENTRY_REF_SECRET`, or `ADMIN_PASSWORD` when that secret is not set. The same member gets the same reference every month, so they can recognise their own number.

Set `ENTRY_REF_SECRET` to a long random value and leave it in place. Changing the secret changes newly calculated references. A draw that was already saved keeps the reference stored on that row. Prefer a dedicated secret so that changing the admin password does not renumber everyone.

The admin member list shows the full name beside the entry reference. The admin draw result, and the official draw record on that same panel, show the full name. Those names are read live from the Members API. They are not written into the draw collection.

## Draw history

Past draws are stored in a Wix CMS collection named `LotteryDraws`. Each row stores the member id, initials, entry reference, month, entry count, pot, and the time of the draw. The winner's full name is not stored. The server creates that collection on first use. Read, insert, update, and remove are all limited to site admins. If an older `LotteryDraws` collection already exists from a previous version of this page, delete it in the Wix CMS so the server can recreate it without a name field.

If the Wix CMS app is not installed, or the collection cannot be read, the page still shows the live entry count, prize pot, and next draw. Last winner and past draws stay empty, and the response includes `historyAvailable: false`. The automatic draw and Draw Winner both refuse until CMS is enabled, so a winner is not chosen when it cannot be saved. The server logs that skip. Add the CMS app in the Wix dashboard, then reload the page. The server creates `LotteryDraws` on the next successful draw.

## Automatic draw

The draw runs at 20:00 Europe/London on the 1st of every month. During British Summer Time that instant is 19:00 UTC. During Greenwich Mean Time it is 20:00 UTC. 1 October 2026 20:00 BST is 19:00 UTC. 1 December 2026 20:00 GMT is 20:00 UTC.

Vercel cron is scheduled in UTC and can run late on the Hobby plan. `vercel.json` calls `/api/cron/draw` at 19:00, 20:00, 21:00, and 22:00 UTC on day 1. The handler draws only when London time is on or after 20:00 on the 1st, and only when that month has no saved draw. A call before 20:00 UK time returns 200 and does not draw. Set `CRON_SECRET`. Vercel sends it as `Authorization: Bearer $CRON_SECRET`.

`GET /api/state` runs the same draw if the month is due and no result is saved yet, so a late cron does not hold the result back. The public page counts down to the next 20:00 UK time. At that time it shows "Drawing now", polls `/api/state`, and plays the drum as soon as the saved result exists. Later visitors in the same month see the drum once, then Replay.

Each month has one draw. The stored item id is the London month, for example `2026-10`. If two requests insert together, the second one reads back the first winner. The entry count and pot are snapshotted from the active entrants at draw time. The winner is chosen with `crypto.randomInt`.

Draw history goes through a small adapter with `list` and `insertIfAbsent`. The current adapter is the Wix CMS collection. It can be swapped later without changing the draw rules.

In mock mode, a sample past result is always shown as initials and an entry reference. A new mock draw is also stored in an HttpOnly cookie so the same browser still shows it as Last Winner. Production draws are written to the Wix collection, which is the record that every visitor sees.

## Demo drum

Open `/?demo=1` (or `/demo.html`) to see the lottery drum with example data. A banner reads "Demo - example data". The entry slider and Play draw button stay in the browser and do not call Wix. Live pages still load `/api/state`, which includes `entryRefs` (the public reference codes only, never names or initials) so the drum can show one ball per entry.

`/?demo=1&countdown=10` rehearses draw night without Wix. The next draw is 10 seconds ahead, about 40 example entries tumble in the drum, the countdown reaches "Drawing now", then the drum plays a fixed example result, `A.B. - Entry 840053`, with confetti and Replay. `countdown` can be any whole number from 1 to 120.

## Local check

```bash
npm test
```

To run the page locally, use the Vercel CLI (`vercel dev`) with `WIX_MOCK=1` and an `ADMIN_PASSWORD` in `.env`.

The page files live in `public/` (`index.html`, `styles.css`, `main.js`, and the logo). Vercel serves that folder for a project with no framework. API routes stay in `api/`.
