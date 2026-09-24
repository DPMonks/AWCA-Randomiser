# AWCA Lottery

A single page for the Alconbury Weald Community Association lottery. Active subscribers are read live from the Wix site. The prize pot is the number of active subscribers times £1.25. An admin can draw one winner, chosen evenly from those active subscribers.

## Environment variables

Set these on the Vercel project. Do not put them in the browser, and do not commit `.env`.

| Name | Required | Purpose |
| --- | --- | --- |
| `WIX_API_KEY` | Yes, for live data | Wix API key. Server only. |
| `WIX_SITE_ID` | Yes, for live data | Meta site id for www.alconbury-weald.org. |
| `WIX_LOTTERY_PLAN_ID` | No | Pricing plan id. If empty, the server picks a plan priced 2.50 GBP, preferring a name that contains "lottery". The chosen plan is written to the Vercel function logs. |
| `ADMIN_PASSWORD` | Yes, to draw or view members | Unlocks the member list and the Draw Winner button. Checked only on the server. |
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

In mock mode, a sample past result is always shown as initials and an entry reference. A new mock draw is also stored in an HttpOnly cookie so the same browser still shows it as Last Winner. Production draws are written to the Wix collection, which is the record that every visitor sees.

## Local check

```bash
npm test
```

To run the page locally, use the Vercel CLI (`vercel dev`) with `WIX_MOCK=1` and an `ADMIN_PASSWORD` in `.env`.

The page files live in `public/` (`index.html`, `styles.css`, `main.js`, and the logo). Vercel serves that folder for a project with no framework. API routes stay in `api/`.
