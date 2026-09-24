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

## Draw history

Past draws are stored in a Wix CMS collection named `LotteryDraws` (winner name, member id, time, entry count, pot). The server creates that collection on first use. No separate database is required. Collection permissions are limited to site admins.

In mock mode, a sample past winner is always shown. Any new mock draw is kept only for the life of that server instance, because there is no Wix site to write to.

## Local check

```bash
npm test
```

To run the page locally, use the Vercel CLI (`vercel dev`) with `WIX_MOCK=1` and an `ADMIN_PASSWORD` in `.env`.

The page files live in `public/` (`index.html`, `styles.css`, `main.js`, and the logo). Vercel serves that folder for a project with no framework. API routes stay in `api/`.
