# n8n-nodes-everycore-sage100

n8n community nodes for the [everycore](https://everycore.net) **Sage 100 Task Service** REST API.

They let an n8n workflow read and write sales documents, transactions and articles in Sage 100 through the Task Service, instead of touching the Sage database or the Sage API directly.

> **Status: 0.1.0, not yet released.** Lint and build pass; nothing has been run against a live n8n yet — see [Before the first release](#before-the-first-release).

## Nodes

| Node | Type | What it does |
|---|---|---|
| **Sage 100** | Action | Sales documents, transactions and articles |
| **Sage 100 Trigger** | Webhook | Starts a workflow when the service pushes an event, with HMAC verification |
| **Sage 100 Poll Trigger** | Polling | Starts a workflow for sales documents that appeared since the last run |

### Sage 100 — operations

**Sales Document** — Get Many, Get Header, Get Positions, Get Open Items, Get Bookings, **Check Editable**, Create, Update Header, Add / Update / Delete Position, Print (PDF), Get Reports

**Sales Transaction** — Get Many, Get, Get Positions

**Article** — Get Many, Get, Search, Get Variants, Update

*Check Editable* is worth knowing about. It answers whether a document may still be changed and, if not, why: it reports follow-up documents and the FiBu state. Once a follow-up exists or the document went to the FiBu, changing it is a business decision — reversal, correction document, manual handling — and not something an import may take on its own. Call it before writing and route the refusals to a human.

## Credentials

**Sage 100 Task Service API** — for the action node and the poll trigger.

| Field | Notes |
|---|---|
| Base URL | `https://server:8090`, no trailing slash |
| API Key | Created in the service under *Settings → API keys*. Shown once, not recoverable |
| Dataset | `DataSource;Mandant`. Leave empty if the key is already bound to one Mandant |
| Ignore SSL Issues | Only for the certificate shipped with Sage |

A key is issued for an existing Sage user and can only *narrow* that user's permissions, never widen them; permissions stay in the Sage 100 Administrator. Give an integration key the least it needs: `View` to read, `EditBeleg` to write documents, `Run` to print, `EditStammdaten` for article master data.

The credential test calls `/api/status`, which needs `View`. A key issued only for `Run` fails the test although its own operations work.

**Sage 100 Webhook Secret** — for the webhook trigger only. This is the `Secret` of the webhook channel, not the API key: it proves that an incoming request really came from the service. Different direction, rotated separately.

## Setting up the webhook trigger

1. Add the **Sage 100 Trigger** node and copy its production webhook URL.
2. In the service go to *Settings → Communication* and create a channel of type `Webhook` with:
   - `WebhookUrl` = the URL from step 1
   - `AuthMode` = `Hmac`
   - `Secret` = a long random value
3. Put the same secret into the **Sage 100 Webhook Secret** credential.

The service signs `HMAC-SHA256` over `<timestamp>.<body>` and sends `X-EVC-Timestamp` plus `X-EVC-Signature: sha256=<hex>`. The node checks the signature *and* the age of the timestamp — a signature alone would let an intercepted request be replayed forever. The tolerance defaults to 300 seconds.

Default payload fields: `ereignis`, `zeitpunkt`, `kanal`, `betreff`, `text`, `aufgabe`, `datenquelle`, `mandant`, `erfolg`, `daten`, and `anhaenge` when the channel sends attachments. Branch on `ereignis`.

## Webhook or polling

Prefer the webhook trigger. It has no delay, and if n8n is down the service keeps its own retry state.

Use the poll trigger when the service cannot reach n8n. Know its limit: the watermark is the highest `BelID` seen, so it fires for **new** documents only. An edit to an existing document does not change its `BelID` and will not fire it. On the first run after activation it records the current position and delivers nothing, so existing documents do not flood the workflow.

## Idempotency

Creating a document is not idempotent — Sage does not deduplicate, and a retried workflow creates a second document. Write your own document number into `Referenznummer` or `Bestellreferenz` via *Update Header*, and look it up with the *Custom Filter (JSON)* of *Get Many* before creating:

```json
[{ "feld": "Beleg.Referenznummer", "wert": "ORD-1001" }]
```

This is check-then-create, not an atomic operation: two workflows running at the same moment can still both create. For scheduled work that is usually acceptable; for a high-rate stream it is not.

## Licensing

Every person who works with Sage 100 data needs a valid Sage licence, whatever the technical route. The service logs into Sage locally through the Mandant object, which is a **3rd-Party Connector**, and machine-to-machine access without an identifiable person is licensed **per customer**. An n8n workflow does not change that — settle it before going live.

## Before the first release

This package was written without a Node.js toolchain available, so it has **never been compiled, linted or run**. Do this first:

```bash
npm install
npm run lint:fix     # mechanical style rules, e.g. trailing periods in descriptions
npm run build
npm run dev          # starts n8n with the node loaded
npx @n8n/scan-community-package n8n-nodes-everycore-sage100
```

Expect to fix things. The parts most likely to need it:

- **Print → binary output.** The `binaryData` post-receive action is the one construct here that could not be checked against a running n8n.
- **Lint style rules.** Parameter description wording and punctuation are checked by `eslint-plugin-n8n-nodes-base`; `lint:fix` handles most of it.
- **`rawBody` in the webhook trigger.** Signature verification depends on getting the body exactly as signed.

For n8n's verified registry the package additionally needs a **public** repository, publishing through **GitHub Actions with provenance** (mandatory since 1 May 2026), MIT licence, no runtime dependencies, and an English-only interface. This package already meets the last three; the `repository` field in `package.json` still points at Azure DevOps and must be changed when the repository moves.

## Licence

[MIT](LICENSE)
