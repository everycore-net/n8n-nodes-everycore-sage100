/**
 * Runs the node inside a real n8n against a real Task Service, which is the only
 * place the declarative routing can be observed.
 *
 * What it is for: every list endpoint of the service answers in one of three
 * shapes, and the node has to turn each into the right thing for a workflow.
 * `{rows: […]}` has to become a stream of records; `{rows: […], summeSoll: …}`
 * must stay one item, because the totals are half the answer; a bare array n8n
 * already spreads by itself. None of that is visible without running it - the
 * package builds and lints either way, and a workflow author is the one who
 * finds out.
 *
 *   N8N_BASE=https://n8n.example.com N8N_USER=… N8N_PASS=… \
 *   CORE_BASE=http://localhost:12292 CORE_REACHABLE=http://10.0.0.5:12292 \
 *   CORE_USER=… CORE_PASS=… SAGE_DATASET="datenquelle;123" \
 *   node tools/live-n8n-check.mjs
 *
 * CORE_BASE is how this script reaches the service; CORE_REACHABLE is how n8n
 * reaches it, which differs as soon as n8n runs in a container or on another
 * machine. Read-only: it lists, it never writes. The API key, the credential and
 * the workflow it creates are all removed in a `finally` block.
 */
const n8n = (process.env.N8N_BASE ?? '').replace(/\/$/, '');
const core = (process.env.CORE_BASE ?? '').replace(/\/$/, '');
const { N8N_USER, N8N_PASS, CORE_USER, CORE_PASS, SAGE_DATASET, CORE_REACHABLE } = process.env;

if (!n8n || !core || !N8N_USER || !N8N_PASS || !CORE_USER || !CORE_PASS) {
	console.error('Set N8N_BASE, N8N_USER, N8N_PASS, CORE_BASE, CORE_USER and CORE_PASS.');
	process.exit(1);
}

const NAME = 'zz-sage100-live-check';
const WEBHOOK = 'sage100-live-check';

const coreCall = async (path, body, token) => {
	const res = await fetch(core + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			Accept: 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const type = res.headers.get('content-type') ?? '';
	return { status: res.status, body: type.includes('json') ? await res.json() : null };
};

const session = await coreCall('/api/auth/login', { User: CORE_USER, Password: CORE_PASS });
if (session.status !== 200) throw new Error(`Task Service login failed: HTTP ${session.status}`);
const token = session.body.token;

// The key is created through the action segment on purpose: a plain
// POST /api/apikeys matches both Create and Revoke and answers 500.
const key = await coreCall('/api/apikeys/create', {
	Bezeichnung: 'n8n live check', SageBenutzer: CORE_USER, Rechte: 'View,Run',
}, token);
if (key.status !== 200) throw new Error(`Could not create an API key: HTTP ${key.status}`);
console.log(`api key ${key.body.keyId} created`);

/** A document with positions, so the positions probe says something. */
const withPositions = async () => {
	const list = await coreCall(`/api/belege/list?take=10&sort=BelID&dir=desc`, undefined, token);
	for (const row of list.body?.rows ?? []) {
		const positions = await coreCall(`/api/belege/positionen?belId=${row.belId}`, undefined, token);
		if ((positions.body?.count ?? 0) > 0) return { belId: String(row.belId), count: positions.body.count };
	}
	return null;
};

let cookie = '';
const rest = async (method, path, body) => {
	const res = await fetch(n8n + path, {
		method,
		headers: { Accept: 'application/json', cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const type = res.headers.get('content-type') ?? '';
	return { status: res.status, body: type.includes('json') ? await res.json() : null, res };
};

const removeWorkflow = async (id) => {
	await rest('POST', `/rest/workflows/${id}/archive`);
	return (await rest('DELETE', `/rest/workflows/${id}`)).status;
};

const state = { credentialId: null, workflowId: null };
let failures = 0;

try {
	const login = await rest('POST', '/rest/login', {
		emailOrLdapLoginId: N8N_USER, email: N8N_USER, password: N8N_PASS,
	});
	if (login.status !== 200) throw new Error(`n8n login failed: HTTP ${login.status}`);
	cookie = (login.res.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');

	for (const workflow of (await rest('GET', '/rest/workflows?includeScopes=false')).body?.data ?? []) {
		if (workflow.name === NAME) await removeWorkflow(workflow.id);
	}

	const credentialData = {
		baseUrl: CORE_REACHABLE ?? core,
		apiKey: key.body.key,
		dataset: SAGE_DATASET ?? '',
		ignoreSslIssues: false,
		webhookSecret: '',
		webhookSignatureHeader: 'X-EVC-Signature',
	};
	const credential = await rest('POST', '/rest/credentials', { name: NAME, type: 'sage100TaskServiceApi', data: credentialData });
	state.credentialId = credential.body?.data?.id ?? credential.body?.id;

	const test = await rest('POST', '/rest/credentials/test', {
		credentials: { id: state.credentialId, name: NAME, type: 'sage100TaskServiceApi', data: credentialData },
	});
	const verdict = test.body?.data ?? test.body;
	console.log(`credential test: ${verdict?.status ?? test.status} ${verdict?.message ?? ''}`);
	if (verdict?.status !== 'OK') failures += 1;

	/**
	 * `expect` is the contract, not a description:
	 *   stream   - several items, no envelope around them
	 *   envelope - exactly one item that still carries `rows`
	 */
	const run = async (label, parameters, expect) => {
		if (state.workflowId) { await removeWorkflow(state.workflowId); state.workflowId = null; }

		const definition = {
			name: NAME,
			settings: { executionOrder: 'v1' },
			nodes: [
				{
					id: '11111111-1111-4111-8111-111111111111', name: 'Webhook',
					type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
					parameters: { path: WEBHOOK, httpMethod: 'GET', responseMode: 'lastNode', responseData: 'allEntries' },
					webhookId: '22222222-2222-4222-8222-222222222222',
				},
				{
					id: '33333333-3333-4333-8333-333333333333', name: 'Sage 100',
					type: 'n8n-nodes-everycore-sage100.sage100', typeVersion: 1, position: [220, 0],
					parameters,
					credentials: { sage100TaskServiceApi: { id: state.credentialId, name: NAME } },
				},
			],
			connections: { Webhook: { main: [[{ node: 'Sage 100', type: 'main', index: 0 }]] } },
		};

		const workflow = await rest('POST', '/rest/workflows', definition);
		const record = workflow.body?.data ?? workflow.body;
		state.workflowId = record.id;
		await rest('POST', `/rest/workflows/${record.id}/activate`, { versionId: record.versionId });
		const stored = await rest('GET', `/rest/workflows/${record.id}`);
		if (((stored.body?.data ?? stored.body)?.active) !== true) {
			console.log(`${label}: could not activate`);
			failures += 1;
			return;
		}

		const hook = await fetch(`${n8n}/webhook/${WEBHOOK}`);
		if (!(hook.headers.get('content-type') ?? '').includes('json')) {
			console.log(`${label}: HTTP ${hook.status}, not JSON`);
			failures += 1;
			return;
		}

		const payload = await hook.json();
		const items = Array.isArray(payload) ? payload : [payload];
		const keys = Object.keys(items[0] ?? {});
		const envelope = keys.includes('rows');
		const ok = expect === 'envelope' ? envelope && items.length === 1 : !envelope && items.length > 0;
		if (!ok) failures += 1;
		console.log(
			`${label.padEnd(22)} ${String(items.length).padStart(3)} item(s)  ` +
			`${(envelope ? 'envelope' : 'records').padEnd(8)} ${ok ? 'ok' : '<-- wrong'}  ${keys.slice(0, 5).join(',')}`,
		);
	};

	const sample = await withPositions();
	console.log(sample ? `positions probe uses document ${sample.belId} (${sample.count} positions)` : 'no document with positions found');

	console.log('\nlists — must arrive as records');
	await run('beleg getAll', { resource: 'beleg', operation: 'getAll', returnAll: false, limit: 5 }, 'stream');
	await run('artikel getAll', { resource: 'artikel', operation: 'getAll', returnAll: false, limit: 4 }, 'stream');
	await run('vorgang getAll', { resource: 'vorgang', operation: 'getAll', returnAll: false, limit: 4 }, 'stream');
	if (sample) await run('beleg getPositions', { resource: 'beleg', operation: 'getPositions', belId: sample.belId }, 'stream');

	console.log('\ntotals — must stay one item, or the sums are lost');
	if (sample) {
		await run('beleg getBookings', { resource: 'beleg', operation: 'getBookings', belId: sample.belId }, 'envelope');
		await run('beleg getOpenItems', { resource: 'beleg', operation: 'getOpenItems', belId: sample.belId }, 'envelope');
	}

	console.log('\nbare arrays — n8n spreads these without help');
	await run('artikel search', { resource: 'artikel', operation: 'search', q: '0', take: 3 }, 'stream');
	if (sample) await run('beleg getReports', { resource: 'beleg', operation: 'getReports', belId: sample.belId }, 'stream');
} finally {
	console.log('\ncleanup');
	if (state.workflowId) console.log(`   workflow: HTTP ${await removeWorkflow(state.workflowId)}`);
	if (state.credentialId) console.log(`   credential: HTTP ${(await rest('DELETE', `/rest/credentials/${state.credentialId}`)).status}`);
	const revoked = await coreCall('/api/apikeys/revoke', { KeyId: key.body.keyId }, token);
	console.log(`   api key ${key.body.keyId}: revoke HTTP ${revoked.status}`);
	console.log(failures === 0 ? '\nall probes behaved as contracted' : `\n${failures} probe(s) did not`);
}

process.exit(failures === 0 ? 0 : 1);
