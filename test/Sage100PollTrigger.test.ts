import { describe, expect, it } from 'vitest';
import type { IDataObject, IHttpRequestOptions, INodeExecutionData, IPollFunctions } from 'n8n-workflow';

import { Sage100PollTrigger } from '../nodes/Sage100PollTrigger/Sage100PollTrigger.node';

/**
 * The trigger holds the only stateful logic in this package, and its contract is
 * about what must *not* happen: activating a workflow must not replay the whole
 * Belege table into it, testing it must not consume the documents the first real
 * run should deliver, and a poll that cannot see far enough back must not drop
 * documents quietly.
 *
 * The fake IPollFunctions records requests, so "how many calls" and "what was in
 * the query string" are assertions rather than assumptions.
 */

interface HarnessOptions {
	rows: IDataObject[];
	staticData?: IDataObject;
	runMode?: 'manual' | 'trigger';
	filters?: IDataObject;
	batchSize?: number;
	fail?: unknown;
}

const harness = (options: HarnessOptions) => {
	const requests: IHttpRequestOptions[] = [];
	const staticData: IDataObject = options.staticData ?? {};

	const context = {
		getNodeParameter: (name: string, fallback?: unknown) => {
			if (name === 'filters') return options.filters ?? {};
			if (name === 'batchSize') return options.batchSize ?? 100;
			return fallback;
		},
		getCredentials: async () => ({ baseUrl: 'https://sage.example', apiKey: 'key', ignoreSslIssues: false }),
		getWorkflowStaticData: () => staticData,
		getMode: () => options.runMode ?? 'trigger',
		getNode: () => ({
			id: 'test',
			name: 'Sage 100 Poll Trigger',
			type: 'n8n-nodes-everycore-sage100.sage100PollTrigger',
			typeVersion: 1,
			position: [0, 0] as [number, number],
			parameters: {},
		}),
		helpers: {
			httpRequestWithAuthentication: async (_credentialType: string, request: IHttpRequestOptions) => {
				requests.push(request);
				if (options.fail !== undefined) throw options.fail;
				return { rows: options.rows };
			},
			returnJsonArray: (items: IDataObject[]): INodeExecutionData[] => items.map((json) => ({ json })),
		},
	};

	return {
		requests,
		staticData,
		poll: async () =>
			(await Sage100PollTrigger.prototype.poll.call(context as unknown as IPollFunctions)) as
				| INodeExecutionData[][]
				| null,
	};
};

/** The service answers newest first, which is what the trigger asks for. */
const documents = (...ids: number[]): IDataObject[] =>
	ids.map((belId) => ({ belId, belegnummer: `RE-${belId}` }));

const idsOf = (result: INodeExecutionData[][] | null): number[] =>
	(result?.[0] ?? []).map((item) => Number(item.json.belId));

describe('first poll after activation', () => {
	it('remembers the newest document and delivers nothing', async () => {
		const { poll, requests, staticData } = harness({ rows: documents(120, 119, 118) });

		expect(await poll()).toBeNull();
		expect(staticData.lastBelId).toBe(120);
		expect(requests).toHaveLength(1);
	});

	it('asks the service for the newest documents first', async () => {
		const { poll, requests } = harness({ rows: documents(5) });
		await poll();

		expect(requests[0].qs).toMatchObject({ sort: 'BelID', dir: 'desc', take: 100 });
		expect(requests[0].url).toBe('/api/belege/list');
	});

	it('stays quiet on an empty Belege table without touching the watermark', async () => {
		const { poll, staticData } = harness({ rows: [] });

		expect(await poll()).toBeNull();
		expect(staticData.lastBelId).toBeUndefined();
	});
});

describe('manual execution', () => {
	it('shows the newest documents and leaves the watermark alone', async () => {
		const { poll, staticData } = harness({
			runMode: 'manual',
			rows: documents(9, 8, 7),
			staticData: { lastBelId: 5 },
		});

		expect(idsOf(await poll())).toEqual([9, 8, 7]);
		expect(staticData.lastBelId).toBe(5);
	});

	it('does not adopt a watermark on a fresh node either', async () => {
		const { poll, staticData } = harness({ runMode: 'manual', rows: documents(9) });

		expect(idsOf(await poll())).toEqual([9]);
		expect(staticData.lastBelId).toBeUndefined();
	});
});

describe('new documents', () => {
	it('delivers only what is above the watermark, oldest first', async () => {
		const { poll, staticData } = harness({
			rows: documents(14, 13, 12, 11, 10),
			staticData: { lastBelId: 12 },
		});

		expect(idsOf(await poll())).toEqual([13, 14]);
		expect(staticData.lastBelId).toBe(14);
	});

	it('returns null and keeps the watermark when nothing is new', async () => {
		const { poll, staticData } = harness({
			rows: documents(12, 11, 10),
			staticData: { lastBelId: 12 },
		});

		expect(await poll()).toBeNull();
		expect(staticData.lastBelId).toBe(12);
	});
});

describe('a batch that is too small', () => {
	it('refuses rather than skip the documents it cannot see', async () => {
		const { poll, staticData } = harness({
			batchSize: 3,
			rows: documents(30, 29, 28),
			staticData: { lastBelId: 10 },
		});

		await expect(poll()).rejects.toThrow(/More than 3 new sales documents/);
		// The watermark must survive the refusal, or the next poll would skip them.
		expect(staticData.lastBelId).toBe(10);
	});

	it('accepts a full batch as long as part of it is already known', async () => {
		const { poll, staticData } = harness({
			batchSize: 3,
			rows: documents(30, 29, 10),
			staticData: { lastBelId: 10 },
		});

		expect(idsOf(await poll())).toEqual([29, 30]);
		expect(staticData.lastBelId).toBe(30);
	});
});

describe('filters and failures', () => {
	it('passes the document type and the custom filter to the service', async () => {
		const { poll, requests } = harness({
			rows: documents(1),
			filters: { belegkennzeichen: 'VFR', custom: '[{"feld":"Beleg.Referenznummer","wert":"ORD-1"}]' },
		});
		await poll();

		expect(requests[0].qs).toMatchObject({
			Belegkennzeichen: 'VFR',
			custom: '[{"feld":"Beleg.Referenznummer","wert":"ORD-1"}]',
		});
	});

	it('reports an unreachable service in words rather than in errno', async () => {
		const { poll } = harness({ rows: [], fail: new Error('connect ECONNREFUSED') });

		// NodeOperationError rewrites the usual network failures into something a
		// workflow author can act on, so the assertion is on that sentence and not
		// on ECONNREFUSED - which is exactly what the user will not see.
		await expect(poll()).rejects.toThrow(/refused the connection/i);
	});
});
