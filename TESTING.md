# Testing brief

How to re-verify this package after a change. The first version of this file was
a hand-off written before anything here had ever run; everything it listed as
unknown has since been answered against a live n8n and a live everycore Core.
What is left is the procedure, and the three constructs that are still worth
re-checking whenever they are touched.

## What is automated and what is not

`npm run lint`, `npm test` and `npm run build` cover what can be checked without
a server. The tests are unit tests over the poll trigger's watermark logic — the
one piece of real logic in the package. Everything else is declarative routing,
and declarative routing is only observable in a running n8n:

| Check | Command | Needs |
|---|---|---|
| Lint, tests, build | `npm run lint && npm test && npm run build` | nothing |
| Translations still cover every key | `npm run translations` | a build |
| Response shapes through real routing | `node tools/live-n8n-check.mjs` | n8n + Core |
| Writes, print, webhook | by hand, see below | n8n + Core, test Mandant |

`tools/live-n8n-check.mjs` is the one worth running after any change to a
description file. It creates its own API key, credential and workflow, drives
every list operation through a webhook, checks each answer arrives in the
contracted shape, and removes all three afterwards:

```
N8N_BASE=https://n8n.example.com N8N_USER=… N8N_PASS=… \
CORE_BASE=http://localhost:12292 CORE_REACHABLE=http://10.0.0.5:12292 \
CORE_USER=… CORE_PASS=… SAGE_DATASET="datenquelle;123" \
node tools/live-n8n-check.mjs
```

`CORE_BASE` is how the script reaches Core, `CORE_REACHABLE` how n8n reaches it —
they differ as soon as n8n runs in a container or on another machine.

## Installing the package into a running n8n

Three routes, in order of how much they prove:

- `npm run dev` (`n8n-node dev`) starts an n8n with the nodes loaded. Fastest
  loop, sidesteps the container, proves the least about a real install.
- `npm pack`, then `npm install` the tarball inside the n8n container's
  `~/.n8n/nodes` and restart it. This is what a customer install looks like.
- Mounting the built package through the custom-extensions directory.

After loading, the three nodes must appear in the node panel under their display
names and the credential must appear in the credential list. If they do not, the
`n8n` section of `package.json` and the `dist` paths are the first place to look.

Note for a German instance: n8n 2.35.5 cannot start with `N8N_DEFAULT_LOCALE=de`
— `POST /rest/node-types` fails with ENOENT for every node including its own
(reported upstream as #38263). The German translation files ship regardless and
take effect once that is fixed.

## The three constructs to re-check when they are touched

These are the parts that cannot fail at build time and cannot fail quietly
either — each one either works or ruins a workflow.

### 1. Print returns binary

*Sales Document* → *Print*, with a `belId` and a `berichtName` from *Get
Reports*. Pass: the item carries binary data, the PDF opens, and `gedruckt` is
set on the document in Sage. Fail modes: base64 text in the JSON instead of
binary, a corrupted file, or the response being parsed as JSON and throwing.

The construct is `postReceive: [{ type: 'binaryData', … }]` together with
`encoding: 'arraybuffer', json: false` in `BelegDescription.ts`. Verified
working; a 162 kB PDF came back.

### 2. Webhook signature verification

HMAC-SHA256 over `"<timestamp>.<body>"`, sent as `X-EVC-Signature: sha256=<hex>`
with `X-EVC-Timestamp` in Unix seconds. The node reads `request.rawBody`.

**A valid signature being accepted proves nothing** — a node that accepts
everything looks identical. Test the refusals, and keep the accepted request in
the same run as a control, or a wrong URL will make every probe look like a
rejection. The production URL is `/webhook/<webhookId>/webhook`: the node
declares `path: 'webhook'`, so the path segment appears twice.

Also do not count executions to decide what got through. n8n records a refused
delivery as an execution with status `error`, so the count is the same either
way. The HTTP status is what distinguishes them: 500 refused, 200 accepted.

Verified: no signature, wrong secret, valid signature over a different body, and
a valid signature an hour old were all refused with 500; the current valid one
was accepted with 200.

### 3. Channel lifecycle

With *Manage Channel* on (default) and an API key holding `Settings`:

- Activating the workflow creates a channel in Core under *Settings →
  Communication*, type `Webhook`, `AuthMode=Hmac`, `WebhookUrl` equal to the
  node's production URL.
- Deactivating removes it.
- Re-activating after the URL changed rewrites the URL rather than leaving a
  stale channel.

The channel is named `n8n-<workflowId>-<nodeName>`. With *Manage Channel* off,
none of the three may touch Core at all.

Activating over the REST API needs `POST /rest/workflows/:id/activate` with the
`versionId` in the body. A plain `PATCH` with `active: true` answers 200 and
leaves the workflow inactive — which then reads as a broken channel lifecycle.

## Wider smoke test

Read-only first, on a test Mandant:

- *Get Many* with and without filters, with *Limit*, with *Custom Filter (JSON)*
- *Get Header*, *Get Positions*, *Get Open Items*, *Get Bookings* for one `belId`
- *Check Editable* for a document that has a follow-up document — it must come
  back `aenderbar: false` with the reasons filled in
- *Get Reports*
- Transactions: *Get Many*, *Get*, *Get Positions*
- Articles: *Get Many*, *Get*, *Search*, *Get Variants*

**Writes create real data in Sage. Use a test Mandant, never a customer's
production database.** Then:

- *Create* with one position, *Update Header*, *Add / Update / Delete Position*,
  *Delete*
- *Update* on an article

Two answers do not carry what the next node needs, and both are documented in
the operations themselves: *Create* answers with `newBelId`, not `belId`, and
*Add Position* answers with counts and totals but no `belPosId`, so the position
must be read back before it can be changed or deleted.

Also worth checking: an empty *Dataset* in the credential against a key that is
bound to a Mandant (must work), and a *Dataset* that contradicts a bound key
(must fail with 400 and a clear message, not 500).

## Rules when changing code here

- `npm run lint` must stay clean. It is stricter than it looks.
- **Do not edit `eslint.config.mjs`.** With `"strict": true` in `package.json`
  it is compared byte for byte against the default; even a comment breaks the
  build.
- No runtime dependencies. Node built-ins are fine.
- Interface text, parameter names and documentation in **English only** — n8n
  rejects anything else for verification. German lives in `translations/`.
- **Reword an English description and the German has to be reworded by hand.**
  `npm run translations` adds keys a node grew and drops ones it lost, but it
  cannot see changed English under an unchanged key, so the German goes on
  describing the old behaviour with nothing looking wrong.
- Option and collection entries must be alphabetical by display name.
- Light and dark icons must be different files, and the icon path must use the
  `file:` protocol — `fa:` icons are rejected for community nodes.
- Parameter descriptions end with a period. `npm run lint:fix` handles that.
- The credential type id is `sage100TaskServiceApi` and stays that way. It is
  the old product name, it is invisible to users, and every stored credential
  and saved workflow refers to it.

## Reporting back

Useful: what was run, exact error text for anything that failed, the n8n version
tested against, and the install route that worked. Commit fixes with a message
that says what was actually wrong rather than "fix lint" — the next person needs
the reason.
