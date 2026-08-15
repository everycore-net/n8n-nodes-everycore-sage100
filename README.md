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

**Sales Document** — Add Position, **Check Editable**, Create, Delete Position, Get Bookings, Get Header, Get Many, Get Open Items, Get Positions, Get Reports, Print (PDF), Update Header, Update Position

**Sales Transaction** — Get Many, Get, Get Positions

**Article** — Get, Get Many, Get Variants, Search, Update

*Check Editable* is worth knowing about. It answers whether a document may still be changed and, if not, why: it reports follow-up documents and the FiBu state. Once a follow-up exists or the document went to the FiBu, changing it is a business decision — reversal, correction document, manual handling — and not something an import may take on its own. Call it before writing and route the refusals to a human.

## Credentials

One credential, **Sage 100 Task Service API**, used by all three nodes.

| Field | Notes |
|---|---|
| Base URL | `https://server:8090`, no trailing slash |
| API Key | Created in the service under *Settings → API keys*. Shown once, not recoverable |
| Dataset | `DataSource;Mandant`. Leave empty if the key is already bound to one Mandant |
| Ignore SSL Issues | Only for the certificate shipped with Sage |
| Webhook Secret | Shared secret of the webhook channel. Only the trigger uses it |
| Webhook Signature Header | Default `X-EVC-Signature` |

The two webhook fields belong to the opposite direction from the key: the key says who may call the service, the secret proves that an incoming event really came from it. They are in one credential because n8n requires every credential to be testable, and a bare secret is not.

A key is issued for an existing Sage user and can only *narrow* that user's permissions, never widen them; permissions stay in the Sage 100 Administrator. Give an integration key the least it needs: `View` to read, `EditBeleg` to write documents, `Run` to print, `EditStammdaten` for article master data, and `Settings` only if the trigger should manage its own channel.

The credential test calls `/api/status`, which needs `View`. A key issued only for `Run` fails the test although its own operations work.

## Setting up the webhook trigger

With **Manage Channel** on (the default), activating the workflow creates the channel in the service and deactivating removes it again. Fill in the Webhook Secret in the credentials, pick the purposes, activate. This needs an API key with the `Settings` permission.

If you would rather not hand out `Settings`, switch Manage Channel off and create the channel yourself under *Settings → Communication*:

- `WebhookUrl` = the production webhook URL of the node
- `AuthMode` = `Hmac`
- `Secret` = the same value as in the credentials

The service signs `HMAC-SHA256` over `<timestamp>.<body>` and sends `X-EVC-Timestamp` plus `X-EVC-Signature: sha256=<hex>`. The node checks the signature *and* the age of the timestamp — a signature alone would let an intercepted request be replayed forever. The tolerance defaults to 300 seconds.

A channel that exists under our name but points at a different URL counts as missing, so a changed tunnel address is rewritten on the next activation instead of leaving a channel that sends into nothing.

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

## Development

```bash
npm install
npm run lint         # clean
npm run build        # TypeScript builds, dist is ~143 KB
npm run dev          # starts n8n with the nodes loaded
npx @n8n/scan-community-package n8n-nodes-everycore-sage100
```

`eslint.config.mjs` is compared byte for byte while `"strict": true` is set in the `n8n` section of `package.json`. Do not add comments to it.

## Before the first release

Lint and build pass, but **nothing here has been exercised against a running n8n or a live Task Service**. Check these first:

- **Print → binary output.** The `binaryData` post-receive action is the least certain construct in the package.
- **`rawBody` in the webhook trigger.** Signature verification depends on getting the body exactly as it was signed; re-serialised JSON will not match.
- **Channel lifecycle.** Activate and deactivate a workflow and confirm the channel appears and disappears in *Settings → Communication*.
- **Icons.** They are hand-drawn placeholders, not an official mark — see the note below.

For n8n's verified registry the package additionally needs a **public** repository, publishing through **GitHub Actions with provenance** (mandatory since 1 May 2026), MIT licence, no runtime dependencies, and an English-only interface. The last three are already met; the `repository` field in `package.json` still points at Azure DevOps and must be changed when the repository moves.

## A note on the icons

`sage100.svg` and `sage100.dark.svg` were drawn for this package. They are **not** Sage's logo and carry no licence from Sage, but the green and the stylised S deliberately evoke Sage's identity, which is a decision to make consciously before publishing anything publicly. Replacing them with an everycore mark, or with a neutral glyph, avoids the question entirely.

## Licence

[MIT](LICENSE)
