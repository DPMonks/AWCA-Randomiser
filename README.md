# AWCA Lottery

A single page for the Alconbury Weald Community Association lottery. Plan orders are read live from the Wix site. Each active lottery plan order is one entry. A second active order on the same member account is a second entry, so that person has two chances. The prize pot is the number of active entries times £1.25, which is half of the £2.50 plan price. The winner is drawn automatically at 20:00 UK time on the 1st of each month, chosen evenly from the active entries. Draw Winner stays as a manual fallback.

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
| `KV_REST_API_URL` | No | REST address for Vercel KV or Upstash Redis. Used to pause admin sign-in after repeated wrong passwords. `UPSTASH_REDIS_REST_URL` is also accepted. |
| `KV_REST_API_TOKEN` | No | Token for that store. `UPSTASH_REDIS_REST_TOKEN` is also accepted. If the store is missing or down, admin sign-in still checks the password. |

If `WIX_API_KEY` or `WIX_SITE_ID` is missing, and mock mode is off, the page shows an error instead of crashing.

Wrong admin passwords are limited to 5 attempts in 15 minutes for each address. The address comes from `x-forwarded-for` or `x-real-ip`, and only a hash of it is stored. A paused sign-in returns HTTP 429 with `Retry-After` and the message "Too many attempts. Please try again in 15 minutes." A correct password clears the count. The same pause applies to the member list, community members, and draw routes. The limit uses the KV store above and is skipped if that store cannot be reached. The password is still checked.

The public site response currently includes meta site id `00d28da8-27ea-4fd0-9272-351423f10120`. Confirm it in the Wix dashboard before saving `WIX_SITE_ID`. The dashboard address for the site usually contains the same id.

## Wix API key

Create the key in the Wix account that owns the site (API Keys in account settings). Site level calls have to use a key from that owning account, and the key has to be allowed to access this site.

Give the key these permissions:

- Read Orders, `SCOPE.DC-PAIDPLANS.READ-ORDERS`
- Read Pricing Plans, `SCOPE.DC-PAIDPLANS.READ-PLANS`
- Read Members, `SCOPE.DC-MEMBERS.READ-MEMBERS`
- Read Contacts, `SCOPE.DC-CONTACTS.READ-CONTACTS`
- Read Data Items, `SCOPE.DC-DATA.READ`
- Write Data Items, `SCOPE.DC-DATA.WRITE`
- Manage Data Collections, `SCOPE.DC-DATA.DATA-COLLECTIONS-MANAGE`

The page calls these REST endpoints:

- `POST https://www.wixapis.com/pricing-plans/v3/plans/query` to find the plan
- `GET https://www.wixapis.com/pricing-plans/v2/orders` to list subscribers, including cancelled and ended orders
- `POST https://www.wixapis.com/members/v1/members/query` with the `FULL` fieldset to read member names and login emails, including every site member for the admin community list
- `POST https://www.wixapis.com/contacts/v4/contacts/query` with the `COMMUNICATION_DETAILS` fieldset to read a contact's primary email when the member login email is empty
- `POST https://www.wixapis.com/wix-data/v2/items/query` and `POST https://www.wixapis.com/wix-data/v2/items` to read and save draws
- `GET https://www.wixapis.com/wix-data/v2/collections/LotteryDraws` and `POST https://www.wixapis.com/wix-data/v2/collections/create-field` to add fingerprint fields when the collection already exists

Headers on every call: `Authorization` set to the API key (not a Bearer token), and `wix-site-id` set to `WIX_SITE_ID`.

## Plan id

In the Wix dashboard, open Pricing Plans and select the £2.50 lottery plan. If the plan id is in the address bar, copy it into `WIX_LOTTERY_PLAN_ID`.

If you leave that variable empty, the server logs a line like `AWCA lottery plan selected: id=... name=... via price 2.50 GBP`. Copy that id into `WIX_LOTTERY_PLAN_ID` once you are happy it is the right plan. Set the variable if more than one plan could match.

Only orders whose status is `ACTIVE` go into the draw. Each active order is its own entry, including two or more active lottery orders on the same Wix member. Cancelled, ended, paused, pending, and draft orders stay on the admin list and are not drawn. When one of those orders stops being active, it drops out of the draw on the next page load. One remaining active order is a single entry again.

An active order can also have auto-renew cancelled, with `cancellation.effectiveAt` set to `NEXT_PAYMENT_DATE`. That member has paid until the next payment date. They stay in the draw by default. Set `EXCLUDE_PENDING_CANCELLATION` to `1` to leave them off the draw while still listing them for the committee. Leave the variable unset, or set it to `0`, to keep the default.

## Public winners and entry references

The public page, the public draw history, and `GET /api/state` never include a winner's full name or email. A winner is shown as initials plus an entry reference, for example `D.M. - Entry 4F7A2C`. A second entry for that person is `D.M. - Entry 4F7A2C (2)`.

The admin member list, the official draw record, and Draw Winner show each lottery subscriber's email next to their name. The address is the member login email from the Members API. If that is empty, it is the contact's primary email. Those addresses are loaded live and are not written into the draw collection. If the API key cannot read them, the admin view shows `Email unavailable`. Login emails need Read Members. Contact emails need Read Contacts, `SCOPE.DC-CONTACTS.READ-CONTACTS`.

The admin section also has Community members. That list is every site member from the Members API, paged 100 at a time, not only people on the lottery plan. Each row shows the name, the email, and the active pricing plans, for example AWCA Lottery, Notice Board, AWCA Community Member, or none. Cancelled and ended orders are not listed as current plans. Search, Copy emails, and Download CSV stay in the browser and only use that admin list. `GET /api/community-members` requires the admin password. It is not part of `GET /api/state`, `GET /api/winners`, or the embed, and it is not stored on a draw. If the key cannot list members, the section says to add Read Members (`SCOPE.DC-MEMBERS.READ-MEMBERS`). If contact emails are blocked, rows show `Email unavailable` and the section names Read Contacts (`SCOPE.DC-CONTACTS.READ-CONTACTS`). If orders cannot be read, the section names Read Orders (`SCOPE.DC-PAIDPLANS.READ-ORDERS`).

Initials come from the first and last name. `Daniel Monks` becomes `D.M.` A single name uses that name's initial. Hyphenated parts each contribute an initial, so `Mary-Jane Watson` becomes `M.J.W.` If no name is available, the public label is the entry reference only.

Wix Pricing Plans orders do not include a short public order number. Order ids are long internal ids, so they are not shown. The entry reference is the first 6 hex characters, in capitals, of an HMAC-SHA256 of the Wix member id. The key is `ENTRY_REF_SECRET`, or `ADMIN_PASSWORD` when that secret is not set. The same member gets the same code every month, so they can recognise their own number. Extra active plans on that account keep the same code and add ` (2)`, ` (3)`, and so on. The first entry has no number. Numbers follow the plan start date, then the date the order was created, then the Wix order id, so the same active orders keep the same numbers on every page load. A cancelled or ended plan is left out, and the active plans are numbered again.

Set `ENTRY_REF_SECRET` to a long random value and leave it in place. Changing the secret changes newly calculated references. A draw that was already saved keeps the reference stored on that row. Prefer a dedicated secret so that changing the admin password does not renumber everyone.

The admin member list shows one row per plan order. The full name is numbered for extra active entries, for example `Daniel Monks (2)`, beside that entry's reference. The admin draw result, and the official draw record on that same panel, show the full name with the same number when the winning entry had one. Those names are read live from the Members API. They are not written into the draw collection. The public page still shows initials and the entry reference only.

## Draw history

Past draws are stored in a Wix CMS collection named `LotteryDraws`. Each row stores the member id, initials, entry reference, month, entry count, pot, the time of the draw, a fairness fingerprint, a hash of the sorted entry references, and the winner index in that sorted list. The winner's full name is not stored. The item id is the London month, for example `2026-10`, so each month can be saved only once. The server creates the collection on first use and adds any missing fingerprint fields to an existing collection. Read, insert, update, and remove are all limited to site admins. If an older `LotteryDraws` collection already exists from a previous version of this page, delete it in the Wix CMS so the server can recreate it without a name field.

If a draw cannot be saved, the page still shows the live entry count, prize pot, and next draw. Last winner and past draws stay empty, and the response includes `historyAvailable: false`. The automatic draw and Draw Winner both refuse, so a winner is not chosen when it cannot be saved. The server logs that skip.

Wix error WDE0110 means the CMS app is not installed. The message in that case says so. Any other storage problem uses a shorter neutral message. Neither message tells visitors how to change the site. This site uses the Harmony editor, which has no Velo and no datasets. CMS is installed separately. On the live site it is already installed.

## Fairness fingerprint

When a draw is saved, the server stores two SHA-256 hex digests. The entrants hash is the hash of the sorted entry references, one reference per line. A second plan for the same member is its own line, the same code with ` (2)` on the end. The fairness fingerprint is the hash of these lines, in order: month, drawn-at time in UTC, winner index, then the same sorted entry references. The winner index counts from 0 in that sorted list. Sorting the references first means the order the orders were loaded does not change the fingerprint.

`GET /api/state` and `GET /api/winners` include the fingerprint and the entrants hash when the saved draw has them. Older draws saved before this check stay on the list without a fingerprint. The public responses still use initials and the entry reference only.

## Past winners on the community site

The Wix page can show past winners under the subscriptions or pricing plans section. In the Harmony editor choose Add, then Elements, then Embed, then Embed a site, and paste:

https://lottery.alconbury-weald.org/winners-embed

Use a width of about 600 pixels and a height of about 320 pixels. The card fits from about 120 pixels tall, when there are no draws yet, to about 400 pixels once a winner and the fairness check are on screen. On a phone the card uses the full iframe width.

Only the winners embed and the business embed can be placed in a frame, and only by `https://www.alconbury-weald.org`, `https://alconbury-weald.org`, `https://*.wix.com`, `https://*.wixsite.com`, `https://*.filesusr.com`, and `https://*.wixstatic.com`. The lottery page itself, including the admin sign-in, sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Those two embeds do not send `X-Frame-Options`.

Every route also sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin`, and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. The content security policy uses `default-src 'self'`. Scripts may load from this site. The home page may also load three.js and cannon-es from `https://cdn.jsdelivr.net`. Styles may be inline. Business logos may load from `wixstatic.com`, `usrfiles.com`, and `wixmp.com`.

`GET /api/winners` is public. A successful response is cached at the CDN for 5 minutes (`s-maxage=300`). It returns the month, the public label, the pot, the entry count, the drawn-at time, and the fairness fingerprint when one was stored. It does not return full names, member ids, or emails.

Open `/winners-embed?example=1` to preview three fake winners. That preview shows a banner: "Example data. Not a real draw."

## Automatic draw

The draw runs at 20:00 Europe/London on the 1st of every month. During British Summer Time that instant is 19:00 UTC. During Greenwich Mean Time it is 20:00 UTC. 1 October 2026 20:00 BST is 19:00 UTC. 1 December 2026 20:00 GMT is 20:00 UTC.

The automatic draw, from cron and from a visit to the public page, runs only in the 24 hours after that instant. A late cron or a visitor on the morning of the 2nd can still catch the same month. After that window the month is left without an automatic draw. A later visit must not back-fill it, including when draw storage was offline on the 1st and only comes online mid-month. Draw Winner remains the manual fallback and can still save the current month if the committee chooses to.

Vercel cron is scheduled in UTC and can run late on the Hobby plan. `vercel.json` calls `/api/cron/draw` at 19:00, 20:00, 21:00, and 22:00 UTC on day 1. The handler draws only inside that 24 hour window, and only when that month has no saved draw. A call before 20:00 UK time, or after the window has closed, returns 200 and does not draw. Set `CRON_SECRET`. Vercel sends it as `Authorization: Bearer $CRON_SECRET`.

`GET /api/state` runs the same draw if the month is due and no result is saved yet, so a late cron does not hold the result back. The public page counts down to the next 20:00 UK time. At that time it shows "Drawing now", polls `/api/state`, and plays the drum as soon as the saved result exists. Later visitors in the same month see the drum once.

Each month has one draw. The stored item id is the London month, for example `2026-10`. If two requests insert together, the second one reads back the first winner. The entry count and pot are snapshotted from the active entries at draw time, one entry per active plan order. The winner is chosen with `crypto.randomInt`, once per entry, so two active plans give two chances.

Draw history goes through a small adapter with `list` and `insertIfAbsent`. The current adapter is the Wix CMS collection. It can be swapped later without changing the draw rules.

In mock mode, a sample past result is always shown as initials and an entry reference. A new mock draw is also stored in an HttpOnly cookie so the same browser still shows it as Last Winner. Production draws are written to the Wix collection, which is the record that every visitor sees.

## Demo drum

Open `/?demo=1` (or `/demo.html`) to see the lottery drum with example data. A banner reads "Demo - example data". The entry slider and Play draw button stay in the browser and do not call Wix. Live pages still load `/api/state`, which includes `entryRefs` (the public reference codes only, never names or initials) so the drum can show one ball per entry.

`/?demo=1&countdown=10` rehearses draw night without Wix. The next draw is 10 seconds ahead, about 40 example entries tumble in the drum, the countdown reaches "Drawing now", then the drum plays a fixed example result, `A.B. - Entry 840053`, with confetti. `countdown` can be any whole number from 1 to 120.

## Local check

```bash
npm test
```

To run the page locally, use the Vercel CLI (`vercel dev`) with `WIX_MOCK=1` and an `ADMIN_PASSWORD` in `.env`.

The page files live in `public/` (`index.html`, `styles.css`, `main.js`, and the logo). Vercel serves that folder for a project with no framework. API routes stay in `api/`.
