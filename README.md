# n8n-nodes-everycore-sage100

n8n community nodes for the [everycore](https://everycore.net) **Sage 100 Task Service** REST API.

They let an n8n workflow read and write sales documents, transactions and articles in Sage 100 through the Task Service, instead of touching the Sage database or the Sage API directly.

> **Status: 0.1.0, not yet released.** Lint, tests and build pass, and the reading operations have been exercised against a live n8n and a live Task Service — see [Before the first release](#before-the-first-release) for what is still open.

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

## Language

The interface is English, as n8n requires of a community node. A German instance — one started with `N8N_DEFAULT_LOCALE=de` — gets German labels instead: the package ships translation files, and n8n reads them per node.

The German is the point rather than decoration: the terms a Sage user knows are German, and translating *Beleg* into "sales document" for a German bookkeeper helps nobody. What stays untranslated in both languages is anything typed or matched literally — `BelID`, `Belegkennzeichen`, `KHKVKBelege.BelID`, a report name like `rptVKRechnung.Sage.Wawi`.

```bash
npm run translations   # refresh the key list from the built nodes
```

The generator never overwrites a translated value; it adds keys the nodes have grown and reports what is still English. Two things about the mechanism are worth knowing before touching it. The file name is the **whole node type**, package included — `n8n-nodes-everycore-sage100.sage100.json` — because n8n strips only its own `n8n-nodes-base.` prefix. And `n8n-node build` copies only images and `__schema__`, so `tools/copy-translations.mjs` puts the files into `dist`; without it everything builds, publishes and installs, and a German instance silently shows English.

## Licensing

Every person who works with Sage 100 data needs a valid Sage licence, whatever the technical route. The service logs into Sage locally through the Mandant object, which is a **3rd-Party Connector**, and machine-to-machine access without an identifiable person is licensed **per customer**. An n8n workflow does not change that — settle it before going live.

## Development

```bash
npm install
npm run lint         # clean
npm test             # 11 tests around the poll trigger's watermark
npm run build        # TypeScript builds, then copies the translations
npm run dev          # starts n8n with the nodes loaded
npx @n8n/scan-community-package n8n-nodes-everycore-sage100
```

`eslint.config.mjs` is compared byte for byte while `"strict": true` is set in the `n8n` section of `package.json`. Do not add comments to it.

## What a list operation delivers

Three shapes come back from the service, and each becomes something different in a workflow:

| Service answers | Node delivers | Operations |
|---|---|---|
| `{rows: […], count, gesamt}` | one item per record | Get Many (all three resources), Get Positions |
| `{rows: […], summeSoll, summeRest}` | **one item, envelope intact** | Get Bookings, Get Open Items |
| a bare array | one item per record (n8n spreads it) | Search, Get Variants, Get Reports |

The middle row is deliberate. Unwrapping those would drop `summeSoll`, `summeHaben` and `summeRest`, and for a bookings query the totals are half the answer. Where the envelope only carries paging counters, it goes.

The service keeps its envelope for everyone — the Core web interface pages through `gesamt`/`seiten` — and the node adapts it. An API contract does not bend for one consumer.

## Before the first release

Checked on 10 September 2026 against n8n 2.35.5 and a live Task Service (Mandant 123) with `tools/live-n8n-check.mjs`: credential test, all three Get Many operations, Get Positions, Get Bookings, Get Open Items, Search and Get Reports — each delivering the shape above. The script creates its own API key, credential and workflow and removes all three afterwards.

The writing operations were run against Mandant 123 on the same day, through two workflows on the working n8n: create a document, add a position, change the header, change a position, delete it, read the result — and print, which came back as a 162 kB PDF and set `gedruckt` on the document in Sage. Two answers do not contain what a workflow needs next, and both are now said in the operation's own description: **Create answers with `newBelId`**, not `belId`, and **Add Position answers with counts and totals but no `belPosId`**, so the position has to be read back before it can be changed or deleted.

Still unproven:

- **`rawBody` in the webhook trigger.** Signature verification depends on getting the body exactly as it was signed; re-serialised JSON will not match.
- **Channel lifecycle.** Activate and deactivate a workflow and confirm the channel appears and disappears in *Settings → Communication*.

And one gap rather than a doubt: the service can delete a document (`/api/belege/loeschen`) but the node has no operation for it. A workflow can create documents and cannot clean up after itself.

For n8n's verified registry the package needs a **public** repository, publishing through **GitHub Actions with provenance** (mandatory since 1 May 2026), MIT licence, no runtime dependencies, and an English-only interface. All of those are met.

## Icons

The nodes carry the everycore mark, not Sage's. `everycore.svg` (transparent) is the light-theme variant, `everycore.dark.svg` (on the dark tile) the dark-theme one; n8n rejects a pair that points at the same file. Using our own mark keeps Sage's trade dress out of a package we publish under our own name.

## Licence

[MIT](LICENSE)
