# Testing brief

Hand-off for whoever verifies this package against a running n8n. Written after
the package was authored on a machine with no n8n available.

## State at hand-off

Commit `0f62ea0` on `main`. `npm run lint` is clean and `npm run build`
succeeds. **Nothing in this package has ever run against a live n8n or a live
Sage 100 Task Service.** Everything below is therefore unverified behaviour, not
regression testing.

Three nodes and one credential:

- `Sage100` — declarative action node (documents, transactions, articles)
- `Sage100Trigger` — webhook receiver with HMAC verification and channel lifecycle
- `Sage100PollTrigger` — polling trigger on new documents
- `Sage100TaskServiceApi` — base URL, API key, dataset, SSL flag, webhook secret

## Before touching anything: find out

Do not assume any of this — check it and write down what you found.

1. **How n8n runs here.** `docker ps`, then the compose file or `docker inspect`.
   Which image tag, which n8n version, which volumes, is `~/.n8n` persisted.
2. **Whether Node.js is on the host** and which version. The package needs
   `>=20.15` to build.
3. **Whether the container can reach the Task Service.** From inside the
   container: `curl -sS -o /dev/null -w '%{http_code}' https://<sage-host>:8090/api/status`
   with an `Authorization: Bearer <key>` header. If the service uses the
   certificate shipped with Sage, expect a TLS failure until *Ignore SSL Issues*
   is set in the credential.
4. **Which API key exists** and which permissions it holds. Needs `View` at
   minimum, `Run` for print, `EditBeleg` for writes, `EditStammdaten` for
   articles, `Settings` if the trigger is to manage its own channel.

## Installing the package into n8n

The official docs move — check the current page rather than trusting a recipe
from memory. As of writing, the usual routes are:

- `npm run dev` (`n8n-node dev`) starts an n8n with the nodes loaded. Simplest
  for a first look, and it sidesteps the container entirely.
- A tarball from `npm pack`, installed into the community-node directory that
  the running n8n reads, then restart the container.
- Mounting the built package through the custom-extensions directory.

Whichever route: after loading, the three nodes must appear in the node panel
under their display names and the credential must appear in the credential list.
If they do not, the `n8n` section of `package.json` and the `dist` paths are the
first place to look.

## The three things most likely to be wrong

These are the constructs that could not be checked without a running n8n. Test
them first; the rest of the package is ordinary declarative routing.

### 1. Print returns binary

`Sage 100` → resource *Sales Document* → operation *Print*, with a `belId` and a
`berichtName` from *Get Reports*.

Pass: the item has binary data with a PDF in it, and the PDF opens. Fail modes to
watch for: base64 text landing in the JSON instead of binary, a corrupted file,
or the response being parsed as JSON and throwing.

The suspect is `postReceive: [{ type: 'binaryData', ... }]` together with
`encoding: 'arraybuffer', json: false` in `BelegDescription.ts`. If it does not
work declaratively, the operation may have to move into a programmatic
`execute`, which is a bigger change — say so rather than bodging it.

### 2. Webhook signature verification

The signature is HMAC-SHA256 over `"<timestamp>.<body>"`, sent as
`X-EVC-Signature: sha256=<hex>` with `X-EVC-Timestamp` in Unix seconds. The node
reads `request.rawBody`.

Pass: a genuine event from the service starts the workflow. Then deliberately
break it — change one character of the secret in the credential and send again:
that must be rejected, not accepted.

If `rawBody` is empty or already parsed, verification will fail on every request.
That is the thing to establish. Sending a hand-rolled request with `curl` is a
fine way to test both paths; compute the signature the same way
`CustomWebhookChannel.Signature` does in the Task Service repository.

### 3. Channel lifecycle

With *Manage Channel* on (default) and an API key holding `Settings`:

- Activating the workflow must create a channel in the service under
  *Settings → Communication*, type `Webhook`, `AuthMode=Hmac`, `WebhookUrl`
  equal to the node's production URL.
- Deactivating must remove it.
- Re-activating after the URL changed must rewrite the URL rather than leave a
  stale channel.

The channel is named `n8n-<workflowId>-<nodeName>`. With *Manage Channel* off,
none of the three should touch the service at all.

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

- *Create* with one position, *Update Header*, *Add / Update / Delete Position*
- *Update* on an article

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
  rejects anything else for verification.
- Option and collection entries must be alphabetical by display name.
- Light and dark icons must be different files.
- Parameter descriptions end with a period. `npm run lint:fix` handles that.

## Reporting back

Useful: which of the three risk areas passed, exact error text for anything that
failed, the n8n version tested against, and the install route that worked.
Commit fixes with a message that says what was actually wrong rather than
"fix lint" — the next person needs the reason.
