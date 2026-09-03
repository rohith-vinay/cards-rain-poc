# Rain corporate card program — sandbox backend

A complete backend for running a **Rain-managed corporate card program** end to end against
Rain's sandbox: KYB onboarding, collateral, card issuance, card configuration and management,
the full spend lifecycle, disputes, and a verified webhook receiver.

**Sandbox only.** The server refuses to start against `api.raincards.xyz`. The `/simulate`
endpoints this depends on return `404` in production by design.

---

## Setup

```bash
npm install
cp .env.example .env      # then fill in RAIN_API_KEY and RAIN_OWNER_ADDRESS
npm start
```

| Variable | Notes |
|---|---|
| `RAIN_API_KEY` | Sandbox key from the Rain developer dashboard |
| `RAIN_OWNER_ADDRESS` | EVM wallet that owns the company collateral contract — **required** |
| `RAIN_CHAIN_ID` | Chain for the contract. Default `84532` (Base Sepolia) — confirm what your tenant is provisioned for |
| `RAIN_WEBHOOK_SIGNING_KEY` | Defaults to `RAIN_API_KEY`. Set this if you made a dedicated `webhookSigning` key |
| `RAIN_WEBHOOK_SIGNING_KEY_SECONDARY` | Set only while rotating signing keys |

### Webhooks

Rain rejects any webhook URL that resolves to a private or loopback address, so `localhost`
cannot be registered. Expose the server first, then set the resulting URL in the dashboard:

```bash
cloudflared tunnel --url http://localhost:4040
```

Register `https://<your-tunnel>/webhooks/rain`.

---

## The demo portal

A single page styled as **Aloha**, served by the same Express process — no build step, no
second port, no CORS. On demo day the whole thing is one command.

```bash
npm run seed     # provision partners and businesses — do this BEFORE the demo
npm start        # then open http://localhost:4040
```

Seeding **replaces** the local business list each run — every run creates new companies
in Rain, so appending would leave the picker showing two of everything. Pass `--append`
to keep what is already there. Nothing is ever deleted on Rain's side.

`npm run seed` creates three partners and six businesses — Partner A with Business A1, A2
and A3; Partner B with B1 and B2; Partner C with C1 — funds every one with $50,000 of
simulated collateral, and adds cardholders. The labels are deliberately plain so the
hierarchy reads itself on screen. It refuses to mark a business ready until
spending power is confirmed above zero, so the slow and occasionally flaky parts — KYB and
collateral crediting — happen well before an audience.

### Two businesses side by side

The portal is white-labelled per partner: the sidebar carries the partner name in that
partner's colour with the business beneath it, so each window reads as that partner's own
sender portal. It still serves every business from one port — the picker is a demo
convenience, not an Aloha feature (a real Aloha user's business comes from their login). To show two partners
at once, open two browser windows against the same server and deep-link each one:

```
http://localhost:4040/?business=A1     # Partner A, blue cards
http://localhost:4040/?business=B1     # Partner B, green cards
```

`business` accepts the short code (`B1`), the full name (`Business B1`) or the company id.
Each window keeps its own selection, sets its own tab title, and updates its URL as you
switch, so a refresh lands you back where you were.

### Demo runbook, about three minutes

1. **Issue a card** — appears instantly in the partner's branding
2. **Simulate a purchase** — type any amount and merchant; watch spending power drop and
   webhooks stream into the live feed
3. **Settle** — the charge moves from pending to posted
4. **Lock the card**, then try to spend again — **refused**. This is the beat that matters:
   everything before it says "we can issue cards", this one says "we control them"
5. **Unlock**, then **Refund** to close the loop
6. **Switch partner** in the header — the same page, a different partner's card design

### What the page is honest about

Partner grouping is Mesta-side. Rain's equivalent is a subtenant, which is not contracted
on this tenant (`GET /issuing/subtenants` returns 403), so Rain sees one program. Card art
IDs are resolved per partner by the backend but stay inert until custom art is contracted
with Rain. Both facts are stated in a footnote on the page rather than left to be discovered.

### Per-partner card design

Rain has no per-tenant design setting — card art is chosen per card at issuance, and Rain
validates only that an art ID is enabled for *your program*, not that the caller owns it.
So `src/partners/registry.ts` holds the `partner → design` map, the card routes resolve
design from the company's partner, and any client-supplied `virtualCardArt` / `productRef` /
`productId` is stripped before the call. A browser cannot issue a card in another partner's
branding.

Set `RAIN_CUSTOM_CARD_ART=true` once Rain has enabled custom art for the program.

## The scripted run

```bash
npm run demo
```

Runs the entire program and narrates each step. Roughly two minutes, most of it waiting on
KYB review and the on-chain contract deploy.

1. Submit a corporate application with two UBOs (KYB)
2. Wait for the KYB decision
3. Deploy the company collateral contract
4. Wait for it to come up on chain
5. Fund it with $50,000 of simulated collateral
6. Wait for spending power to appear
7. Add two employees as cardholders
8. Issue a virtual card to each, with different monthly limits
9. Raise one card's limit to $5,000
10. Authorize $612.75 at a freight merchant
11. Show the hold against company spending power
12. Merchant revises the amount upward
13. Settle, and show the charge post
14. Lock the second card, prove it declines at the terminal, unlock it
15. Authorize a charge and reverse it — hold released, nothing posted
16. Refund part of the settled charge
17. Open a dispute on it

Useful flags:

```bash
npm run demo -- --funding=10000000        # fund $100,000 instead
npm run demo -- --company=<companyId>     # skip onboarding, reuse a company
```

Or drive it over HTTP: `POST /api/demo/run`, then poll `GET /api/demo/state`.

### Deterministic KYB outcomes

Rain's sandbox drives an application to whatever status the person's **last name contains**,
case-insensitively — `TestApproved` → `approved`, `needsverification` → `needsVerification`.
Whitespace breaks the match. The fixtures in `src/rain/fixtures.ts` use this, so a demo can
show an approval and a rejection on demand instead of waiting on a review queue.

```bash
curl -X POST localhost:4040/api/companies \
  -H 'content-type: application/json' \
  -d '{"useFixture": true, "status": "denied"}'
```

---

## API

Everything is under `/api`. Endpoints that hit Rain's sandbox-only simulator are marked ⚡.

### Onboarding (KYB)
| | |
|---|---|
| `POST /api/companies` | Create a corporate application. Empty body uses a valid fixture |
| `GET /api/companies` | List companies |
| `GET /api/companies/:id` | Company detail |
| `PATCH /api/companies/:id` | Update company |
| `GET /api/companies/:id/application` | KYB status for the company and each UBO |
| `POST /api/companies/:id/application/await` | Block until KYB reaches a terminal status |
| `POST /api/companies/:id/ubos` | Add a UBO |
| `PATCH /api/companies/:id/ubos/:uboId` | Update a UBO |
| `PUT /api/companies/:id/documents` | Upload a KYB document (multipart, field `document`) |
| `PUT /api/companies/:id/ubos/:uboId/documents` | Upload a UBO identity document |

### Collateral
| | |
|---|---|
| `POST /api/companies/:id/contracts` | Deploy the collateral contract (needs `ownerAddress`) |
| `GET /api/companies/:id/contracts` | List contracts |
| `POST /api/companies/:id/contracts/await` | Block until the deploy lands |
| ⚡ `POST /api/companies/:id/contracts/:contractId/fund` | Fund collateral, cents |
| `GET /api/companies/:id/balances` | Credit limit, pending, posted, spending power |
| `POST /api/companies/:id/charges` | Charge the company a custom fee |

### Cardholders
| | |
|---|---|
| `POST /api/companies/:id/users` | Add an employee |
| `GET /api/companies/:id/users` | List employees |
| `GET/PATCH/DELETE /api/users/:userId` | Read, update, remove |
| `POST /api/users/:userId/deactivate` · `/reactivate` | Offboard without losing history |
| `GET /api/users/:userId/balances` | Per-employee balances |
| `POST /api/users/:userId/application/await` | Block until their KYC settles |

### Cards
| | |
|---|---|
| `POST /api/users/:userId/cards` | Issue a card (`virtual` or `physical`) |
| `GET /api/cards?companyId=&userId=&status=` | List cards |
| `GET /api/cards/:cardId` | Card detail |
| `PATCH /api/cards/:cardId` | Configure: status, limit, billing address, card art |
| `POST /api/cards/:cardId/limit` | Set spend limit and frequency |
| `POST /api/cards/:cardId/lock` · `/unlock` | Reversible freeze |
| `POST /api/cards/:cardId/cancel` | Permanent — requires `{"confirm": true}` |
| `GET /api/cards/:cardId/secrets` | PAN/CVC. Requires a `SessionId` header (see below) |

### Transactions and disputes
| | |
|---|---|
| `GET /api/transactions?companyId=&userId=&cardId=` | List |
| `GET /api/transactions/:id` | Detail |
| `PATCH /api/transactions/:id` | Attach a memo |
| `POST /api/transactions/:id/disputes` | Open a dispute (settled transactions only) |
| `GET /api/disputes` · `GET/PATCH /api/disputes/:id` | Manage disputes |

### Simulator ⚡
| | |
|---|---|
| `GET /api/simulate/decline-reasons` | All 11 decline reasons |
| `POST /api/simulate/authorize` | Authorize; pass `declineReason` to force a decline |
| `PATCH /api/simulate/transactions/:id/authorize` | Merchant revises the amount |
| `POST /api/simulate/transactions/:id/settle` | Capture; omit `amount` to settle in full |
| `POST /api/simulate/transactions/:id/reverse` | Release the hold, post nothing |
| `POST /api/simulate/transactions/:id/refund` | Credit back a settled charge |
| `POST /api/simulate/collateral/fund` | Top up collateral |

### Events
| | |
|---|---|
| `POST /webhooks/rain` | Rain's receiver — HMAC verified |
| `GET /api/events` | Events received, newest first |
| `GET /api/events/stream` | Server-sent events, for a live demo screen |
| `GET /api/events/deliveries` | Rain's own delivery log |
| `GET/PATCH /api/webhooks/configuration` | Per-event-pattern payload versions |

---

## Design notes

**One HTTP client, not the SDK.** `@rainapi/rain-sdk` generates 60 of the API's 130
operations and pins its base URL to `/v1/issuing`, so it cannot reach `/v1/simulate` — every
endpoint that moves money in sandbox. It also throws if you pass both a base URL and an
environment, so you cannot redirect it. `src/rain/client.ts` covers both prefixes uniformly
in ~120 lines and drops a dependency on an alpha package.

**Webhook verification is order-sensitive.** The receiver is mounted before `express.json()`
so it sees raw bytes. Rain signs the exact body; re-serialising parsed JSON changes key order
and whitespace and will never match. Moving that mount breaks signatures silently.

**GETs retry, writes don't.** Retrying a `POST /simulate/transactions/authorize` would create
a second authorization. Only idempotent reads are retried.

**Card secrets are stubbed at the boundary.** `GET /cards/:cardId/secrets` needs a `SessionId`
header holding an encrypted session id generated against Rain's published sandbox public key,
and returns ciphertext to decrypt locally. The route is wired up and forwards whatever you
pass, but the POC never calls it — the simulator authorizes against the card id, so nothing
here needs a PAN. Implementing the session keypair is the one deliberate gap.

---

## Verified end to end

The full run has been executed against Rain's sandbox with a live key — all 20 steps green,
from KYB through to an open dispute.

Webhooks are verified against **real Rain-signed deliveries** through a public tunnel:
`transaction.requested`, `transaction.created`, `transaction.completed` and `card.updated`
all arrive, verify, and store, with zero signature failures.

See `NOTES.md` for the 25 places where the OpenAPI spec or the docs disagree with the
sandbox's actual behaviour.

### If `npm start` says the port is in use

A server is still running from an earlier session. The error tells you what to do:

```bash
lsof -nP -iTCP:4040 -sTCP:LISTEN     # see what is holding it
pkill -f "tsx src/server.ts"          # stop it
PORT=4041 npm start                   # or just use another port
```

### If every webhook 401s

Check the signing key length first — Rain keys are **40 hex characters**, and a truncated
one produces signatures that never match. Then:

```bash
WEBHOOK_DEBUG=true npm start
```

That prints which key, payload and encoding Rain actually used, against a live signature.

## Known gaps

- **Simulation may not be enabled for your tenant.** `/simulate/*` returns `404` both in
  production and when the tenant lacks access. The server detects this and says so, but only
  Rain can switch it on.
- **`RAIN_CHAIN_ID` is a guess.** Default is Base Sepolia; confirm what your sandbox tenant
  is provisioned for or contract deployment fails.
- **Credit-limit recalculation can stall.** Collateral lands on the contract within seconds,
  but Rain recomputes `creditLimit` on its own schedule — usually under a minute, occasionally
  not at all within ten. The demo waits five minutes and then tells you which stage stalled,
  so you can re-run with `--company=<id>` to resume.
- **UBOs remain `needsVerification`** even once the company is approved. This does not block
  anything in the flow, but it means a UBO-level approval cannot be demonstrated end to end.
- Reports and statements endpoints are not wired up — Rain notes they return no data in sandbox.
