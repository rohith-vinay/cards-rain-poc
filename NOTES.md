# Rain integration notes (sandbox POC)

> Program model: **Rain-managed, CORPORATE** (cardholders are businesses).
> Company-level collateral contract; employees are created inside the company.

Source: docs.rain.xyz (access-gated). Every page has a `.md` twin; index at `/llms.txt`;
full spec at `/openapi.json`. All require the docs session cookie.

## API surface

- Spec: `Issuing API` v1.3.0 — **130 operations**, 104 paths, 106 schemas.
- Sandbox: `https://api-dev.raincards.xyz/v1`
- Production: `https://api.raincards.xyz/v1`
- Auth: `Api-Key: <key>` header. (Spec also defines a `bearerAuth` JWT scheme,
  used for Client Session Tokens in the embedded-wallet flows.)
- Dashboard (sandbox): https://use-dev.raincards.xyz/issuing/transactions

## SDKs (all Stainless-generated, same spec)

| Lang | Package | Version | Published |
|---|---|---|---|
| TypeScript | `@rainapi/rain-sdk` | 0.1.0-alpha.9 | 2026-05-10 |
| Python | `rain-sdk` | 0.5.0 | 2026-07-19 |
| Go | `github.com/SignifyHQ/rain-sdk-go` | v0.1.0 | — |

**SDK covers 60 of 130 operations.** Namespaces: applications, balances, cards,
companies, contracts, disputes, keys, payments, signatures, transactions, users.

Rain's own docs: "The SDK is optional. You can make all the same calls directly
to the Rain REST API using any HTTP client."

### Not in the SDK (the important gaps)

- **`/simulate/*` (8 ops)** — authorize, update, settle, reverse, refund,
  3ds-challenge, payment-routes, collateral/fund, raindrops mint.
  These are how you drive a sandbox POC without real cards.
  NOTE: they live at `/v1/simulate/...`, **outside** the SDK's `/v1/issuing` baseURL.
- **`/issuing/webhooks/*` (7 ops)** — config get/put/patch, signing-key rotation.
- payment-routes / payment-accounts / quotes / transfers (on+offramps)
- raindrops rewards (8 ops)
- shipping-groups (4), reports (2), statements (1), subtenants (4)
- cards: pin get/put, replace, processorDetails, scoped cards
- disputes: attachments (list/upload/download/delete)

## Webhooks (no SDK support at all — hand-rolled)

- Signature: **HMAC-SHA256 over the exact raw request body**, hex in the
  `Signature` header. Secret = one of your tenant API keys (the full key value).
- Rotation sends `Secondary-Signature` alongside `Signature` while both are valid.
  Rotate via `POST /issuing/webhooks/apikey/secondary` then `.../promote`.
- Verify against the **raw body** — parse only after verifying.
- Envelope: `{ id, resource, action, version, eventReceived... }`
- Retries: up to 15, backoff capped at 1 day, gives up after ~1 week.
  Non-2xx or timeout = failed. Rain does **not** follow redirects (3xx = failure).
- URL must be public: private/loopback/link-local/metadata IPs are rejected at
  registration with 400. **Local dev needs a tunnel** (ngrok/cloudflared).

## Card secrets

`GET /issuing/cards/{cardId}/secrets` returns `encryptedPan` / `encryptedCvc`
as `{ data, iv }`. You create a key via `POST /issuing/keys` and decrypt yourself.
Docs: "Viewing Encrypted Card Details" + "Using Encryption Outside of a Browser
Environment" (Node.js server-side variants — the default examples assume browser APIs).

## Sandbox gotchas

- Fund the collateral contract first or every test auth declines with
  `account_credit_limit_exceeded`.
- Test transactions can be driven from the dashboard UI *or* the `/simulate` API.
- Zero-amount auths: create a normal test txn, then update amount to 0.
- Mint test collateral tokens: docs/sandbox-mint-test-tokens-for-collateral

## Open decision

`First Steps` says to pick program type + management model
(**Rain-managed vs Partner-managed**) before following any guide — it changes the
authorization, settlement, and collateral flows. Needs answering before we build.

## Sandbox status fixtures (confirmed in docs)

Rain's sandbox drives an application to a chosen status when the person's **last name
contains that status string**, case-insensitively. Whitespace breaks the match.

- `TestApproved`, `PersonApproved`, `approved` -> `approved`
- `TestNeedsVerification`, `needsverification` -> `needsVerification`
- `Needs Verification` does NOT work (whitespace)

Source: docs/signing-up-a-customer.md, "Test different application statuses [Sandbox only]".
This is what makes a scripted demo deterministic.

## Corporate vs consumer differences that matter

- Onboarding is `POST /issuing/applications/company`, requiring `entity`,
  `representatives`, and `ultimateBeneficialOwners` - all mandatory.
- The collateral contract is created per **company** and requires
  `{chainId, ownerAddress}`. The consumer equivalent takes only `chainId`.
- Cardholders are created with `POST /issuing/companies/{companyId}/users` and share the
  company's collateral. There is no per-user contract.
- Balances exist at tenant, company, and user level.

## Build decision: one HTTP client, not the SDK

`@rainapi/rain-sdk` covers 60 of 130 operations and pins baseURL to `/v1/issuing`, so it
cannot reach `/v1/simulate` at all, and it throws if given both `baseURL` and `environment`.
Built a single typed client over both prefixes instead. See src/rain/client.ts.

---

# Spec vs. reality

Every item below was found by running against the sandbox on 2026-09-01 with a live key.
The OpenAPI spec (v1.3.0) or the docs are wrong or silent on all of them.

## Onboarding

1. **`entity.industry` must be a 6-digit NAICS code**, not prose. Sending
   "Transportation and warehousing" fails with
   `400 FST_ERR_VALIDATION "body/entity/industry must be equal to one of the allowed values"`.
   The spec types it as a plain string. See docs/industry-codes-kyb.

2. **Corporate sandbox status fixtures key off the COMPANY NAME, not a last name.**
   The docs describe only the consumer case ("last name of the user"). Verified:

   | Variant | Result |
   |---|---|
   | company name contains "Approved" | `approved` |
   | all person last names = `approved` | `needsVerification` |
   | all person last names = `TestDenied` | `needsVerification` |

3. **Document upload is required, not optional.** Without it the application sits at
   `needsVerification` indefinitely - nothing has been submitted for Sumsub to process,
   so the status fixture never resolves.

4. **`walletAddress` is required** for Rain-managed corporate. Omitting it gives
   `400 "body is missing required properties 'walletAddress' or 'solanaAddress' or
   'tronAddress' or 'stellarAddress'"`. Note `tronAddress` appears in that error but
   nowhere in the spec.

5. **Application states missing from the spec enum**: `tosNotAccepted`, `notStarted`,
   `exempt`. Documented in docs/application-states but absent from the OpenAPI enum.

6. **UBOs stay at `needsVerification` even when the company reaches `approved`**, and
   this does NOT block contract assignment, cardholder creation, or card issuance.

## Collateral

7. **Contracts are assigned automatically on company approval.** Calling
   `POST /companies/{id}/contracts` afterwards returns `409` with an empty body. Fetch
   first, create only if absent, and treat 409 as success.

8. **Credit-limit recalculation lags, and sometimes stalls.** Funds appear on the
   contract's token balance within seconds, but `creditLimit` / `spendingPower` update
   on Rain's own schedule. One company sat at `creditLimit: 0` for over 10 minutes with
   `50000.0` visibly on the contract. Poll generously and distinguish the two stages.

9. Collateral funded as `rusd` reports back as **`brusd`** on Base (chain 84532).

## Simulator

10. **`settle` requires `amount`** despite the spec marking the whole body optional.
    Without it: `400 "body must have required property 'amount'"`.

11. **`refund` requires `amount`** for the same reason.

12. **`reverse`'s `newAmount` genuinely is optional** - omitting it performs a full
    reversal, as documented.

13. **`completionReason` is lowercase snake_case**, not the spec's `SETTLEMENT`/`REFUND`.
    Observed: `settlement`, `refund`, `authorization_reversal`. The third is not in the
    spec at all. Compare case-insensitively.

14. **A locked card cannot be presented to the simulator.** It validates card status
    first and returns `400 "Card {id} is not active"` rather than a decline. To simulate
    a decline, use `declineReason` against an ACTIVE card. This means the simulator
    cannot reproduce a real-world locked-card decline at the network - the platform
    blocks it earlier.

## Cards

15. **`PATCH /cards/{id}` can return a stale `limit`** in its response body while having
    applied the change. Read the card back if you need to display the new value.

## Findings from the endpoint sweep (2026-09-01)

16. **`GET /issuing/users/{userId}/balances` returns 404 for corporate cardholders.**
    Collateral and credit sit at the company level, so per-employee balances appear not
    to exist in a corporate program. Use the company balances endpoint instead. The
    spec documents the endpoint without noting this.

17. **The `SessionId` mechanism is RSA.** Calling the card secrets endpoint with a
    dummy value returns `400 "Failed to Decrypt Session ID, RSA Public key Not
    Matching"`, which confirms the endpoint is reachable and that the session id must be
    encrypted with Rain's published sandbox RSA public key.

18. **`GET /issuing/webhooks` returned 0 deliveries**, confirming Rain has never
    attempted a webhook against this tenant - no endpoint is registered in the dashboard
    yet. Useful as a check before claiming webhooks work.

## Webhook delivery findings (2026-09-01, live tunnel)

19. **`transaction.requested` IS delivered in a Rain-managed program.** The docs frame
    it as the partner-managed authorization hook, and the transaction-lifecycle pages
    imply a Rain-managed tenant never sees it. In practice Rain sends BOTH
    `transaction.requested` and `transaction.created` for every simulated authorization
    (14 of each over the test run). It appears to be informational here rather than a
    decision point, but a receiver must handle it.

20. **The envelope payload field is `body`, not `data`.** Actual shape:
    `{ id, resource, action, version, body }` where `body` holds the resource, e.g. a
    full IssuingTransaction. Plan for a `data` key and you will read undefined.

21. **No timestamp header.** The signature covers the body alone - there is no
    timestamp-and-body scheme, so replay protection has to come from the envelope id.

22. Merchant fields are space-padded in the payload: `"merchantName":"Capture Probe            "`,
    `"merchantCountry":"  "`. Trim before display or comparison.

23. Delivery is fast: `requestSentAt` to `responseReceivedAt` was 120-330ms in testing,
    and Rain retries promptly on a non-2xx.

24. **Rain API keys are 40 hex characters.** A key truncated to 32 produced signatures
    that never matched, which is indistinguishable from a forged request. If every
    delivery 401s, check the key length first. `WEBHOOK_DEBUG=true` prints the
    key/payload/encoding matrix against a real signature (src/webhooks/diagnose.ts).

25. **Event types observed in a Rain-managed corporate program** (simulated spend):
    `transaction.requested`, `transaction.created`, `transaction.completed` (fires for
    both settlement and refund), and `card.updated` (fires on lock and on unlock).

---

# Per-partner card branding (research, not yet built)

Target structure: Partner N -> businesses N.1..N.M, with card design specific to each partner.

## What Rain gives you

Card design is chosen **per card at issuance**, via `configuration` on
`POST /issuing/users/{userId}/cards`:

| Field | Controls | Mutable later? |
|---|---|---|
| `virtualCardArt` | Virtual card appearance | Yes - `PATCH /issuing/cards/{id}` |
| `productRef` | Physical card appearance | **No** - not in the PATCH schema |
| `productId` | BIN range | **No** |
| `displayName` | Embossed / network name, 26 chars, Latin only | No |

All three of productId/productRef/virtualCardArt are contract-gated: "only relevant if
you have custom ... as part of your contract". Rain rejects an art id that is not enabled
for your program with a 400.

## The critical architectural point

**There is no subtenant-level card design setting.** Design is a per-request parameter,
and subtenant configuration is overwritten by parent configuration anyway (only
`webhookUrl` survives). So Rain cannot express "Partner 1's businesses get Partner 1's
card art".

Consequences:

1. **Mesta owns the partner -> design mapping** and must inject it at issuance.
2. **Rain enforces no entitlement between partners.** It validates only that an art id is
   enabled for the program - not that the caller is the partner who owns it. If a client
   can influence `configuration`, Partner 2 can issue cards in Partner 1's branding.
   Resolve design server-side from the partner; never accept it from the request body.
3. **Branding does NOT depend on subtenants.** They are independent mechanisms, so
   per-partner card art can ship before subtenants are contracted - at the cost of
   co-mingled card/transaction data at the Rain level.

## Gotchas

- Changing `virtualCardArt` on a card already in Apple/Google Pay does not update the
  wallet. The card must be removed and re-added to re-tokenize.
- Physical appearance is immutable: a partner rebrand means reissuing physical cards.
- Per-user card caps depend on contract tier: Developer 3, Startup 10, Enterprise
  consumer 50, Enterprise corporate 101 (counting canceled cards).

---

# What the demo actually invokes

18 of the API's 130 operations, plus four inbound webhook types.

## Phase 1 - `npm run seed` (before the demo, ~6 min)

| Capability | Rain endpoint |
|---|---|
| Submit a corporate application (KYB) | `POST /issuing/applications/company` |
| Upload company KYB document | `PUT /issuing/applications/company/{companyId}/document` |
| Upload each UBO's identity document | `PUT /issuing/applications/company/{companyId}/ubo/{uboId}/document` |
| Poll until KYB reaches a terminal status | `GET /issuing/applications/company/{companyId}` |
| Read the auto-assigned collateral contract | `GET /issuing/companies/{companyId}/contracts` |
| Fund collateral (sandbox) | `POST /simulate/collateral/fund` |
| Confirm spending power before declaring ready | `GET /issuing/companies/{companyId}/balances` |
| Create employees as cardholders | `POST /issuing/companies/{companyId}/users` |

## Phase 2 - the portal, live on screen

| Demo beat | Our route | Rain endpoint |
|---|---|---|
| Load / refresh a business | `GET /api/portal/business/:id` | `GET /issuing/companies/{id}/balances`, `GET /issuing/cards`, `GET /issuing/users`, `GET /issuing/transactions` |
| Issue a card | `POST /api/users/:id/cards` | `GET /issuing/users/{userId}` (for the embossed name), `POST /issuing/users/{userId}/cards` |
| Set a spend limit | `POST /api/cards/:id/limit` | `PATCH /issuing/cards/{cardId}` |
| Lock / unlock | `POST /api/cards/:id/lock` \| `/unlock` | `PATCH /issuing/cards/{cardId}` |
| Authorize a purchase | `POST /api/simulate/authorize` | `POST /simulate/transactions/authorize` |
| Settle | `POST /api/simulate/transactions/:id/settle` | `POST /simulate/transactions/{id}/settle` |
| Reverse | `.../reverse` | `POST /simulate/transactions/{id}/reverse` |
| Refund | `.../refund` | `POST /simulate/transactions/{id}/refund` |

## Phase 3 - inbound, unprompted

Rain calls `POST /webhooks/rain`; each is HMAC-SHA256 verified against the raw body.
Observed during a portal run: `transaction.requested`, `transaction.created`,
`transaction.completed` (fires for both settlement and refund), `card.updated` (fires on
both lock and unlock). Seeding additionally produces `company.updated`, `user.updated` and
`contract.created`.

## Built and verified, but NOT reachable from the portal UI

These run in `npm run demo` (the CLI script) or exist as API routes only:

- `PATCH /simulate/transactions/{id}/authorize` - merchant revises the amount before settling
- `POST /issuing/transactions/{id}/disputes` - open a dispute
- `GET/PATCH /issuing/disputes/{id}` - manage disputes
- `PATCH /issuing/transactions/{id}` - attach a memo
- `POST /issuing/companies/{id}/charges` - charge a platform fee
- `GET /issuing/webhooks`, `GET/PATCH /issuing/webhooks/configuration`
- `POST /issuing/companies/{id}/contracts` - contract creation (Rain assigns one on approval,
  so the portal only reads)

## Disputes: created over the API but absent from Rain's dashboard (open with Rain)

Observed 2026-09-02. A dispute raised through the API is accepted and readable, but does
not appear in Rain's dispute portal, and Rain never sends the `dispute.created` webhook
that its own changelog documents.

What was verified on our side:

- `POST /issuing/transactions/{id}/disputes` returns `200` with an id and `status: pending`.
- The dispute is readable via `GET /issuing/disputes` and `GET /issuing/disputes/{id}`.
- The underlying transaction is genuinely settled: `status: completed`, `postedAt` set.
- The amount is well above the filing threshold. Rain does not file disputes of $10 or
  under, and from 1 September 2026 does not file anything under $30 - ours were $84.20
  and $250.00.
- Evidence attaches successfully: `PUT /issuing/disputes/{id}/evidence` returns `204` and
  `hasFileEvidence` flips to true. Status stays `pending`.
- Webhook configuration is `{}`, and other event families (transaction, card, user,
  company, contract) are all delivered - so nothing is filtering dispute events out.
- Rain's own delivery log (`GET /issuing/webhooks`) records zero dispute deliveries, so
  the event is not being generated rather than lost in transit.

Leading hypothesis: disputes raised against **simulator-created** transactions are
recorded but never escalated into the operational workflow, because there is no real card
network transaction to file a chargeback against. `pending` would then mean "accepted, not
triaged", and the dashboard would only list disputes that reached the network.

Unresolved. Needs a question to Rain: does a sandbox dispute against a simulated
transaction ever leave `pending`, appear in the dashboard, or emit `dispute.created`?
