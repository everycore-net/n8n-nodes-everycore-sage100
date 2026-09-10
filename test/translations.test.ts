import { describe, expect, it } from 'vitest';
import type { INodeProperties, INodeTypeDescription } from 'n8n-workflow';

import { Sage100 } from '../nodes/Sage100/Sage100.node';
import { Sage100PollTrigger } from '../nodes/Sage100PollTrigger/Sage100PollTrigger.node';
import { Sage100Trigger } from '../nodes/Sage100Trigger/Sage100Trigger.node';

// Imported rather than read from disk: the cloud-compatibility lint forbids
// node:fs, node:path and __dirname anywhere in the package, tests included. The
// import path is itself part of what is being checked - n8n looks the file up
// under exactly this name, so a rename breaks the test at load time.
import sage100De from '../nodes/Sage100/translations/de/n8n-nodes-everycore-sage100.sage100.json';
import sage100PollTriggerDe from '../nodes/Sage100PollTrigger/translations/de/n8n-nodes-everycore-sage100.sage100PollTrigger.json';
import sage100TriggerDe from '../nodes/Sage100Trigger/translations/de/n8n-nodes-everycore-sage100.sage100Trigger.json';

/**
 * A translation cannot fail loudly. A missing key falls back to English, a stale
 * key is ignored, and both look like a node that simply was not translated yet -
 * on a German instance, which is the only place either is visible. So the drift
 * is checked here instead, where it costs a red test rather than a customer
 * reading half an interface in the wrong language.
 *
 * What this cannot check is whether the German is *right*. It checks that every
 * key a user can see has one, and that none is left over.
 */

const PACKAGE = 'n8n-nodes-everycore-sage100';

/** The dotted keys n8n builds for a node's visible text. */
function keysOf(properties: INodeProperties[] | undefined, prefix = 'nodeView'): string[] {
	const keys: string[] = [];
	for (const property of properties ?? []) {
		const base = `${prefix}.${property.name}`;
		for (const field of ['displayName', 'description', 'placeholder'] as const) {
			if (property[field]) keys.push(`${base}.${field}`);
		}
		if (property.typeOptions?.multipleValueButtonText) {
			keys.push(`${base}.multipleValueButtonText`);
		}
		for (const option of (property.options ?? []) as Array<Record<string, unknown>>) {
			if (option.value !== undefined) {
				keys.push(`${base}.options.${String(option.value)}.name`);
				if (option.description) keys.push(`${base}.options.${String(option.value)}.description`);
			} else {
				keys.push(`${base}.options.${String(option.name)}.displayName`);
				keys.push(
					...keysOf(
						(option.values ?? option.options) as INodeProperties[] | undefined,
						`${base}.options.${String(option.name)}`,
					),
				);
			}
		}
	}
	return keys;
}

interface Case {
	fileName: string;
	translation: Record<string, unknown>;
	description: INodeTypeDescription;
}

const cases: Case[] = [
	{
		fileName: 'n8n-nodes-everycore-sage100.sage100.json',
		translation: sage100De,
		description: new Sage100().description,
	},
	{
		fileName: 'n8n-nodes-everycore-sage100.sage100PollTrigger.json',
		translation: sage100PollTriggerDe,
		description: new Sage100PollTrigger().description,
	},
	{
		fileName: 'n8n-nodes-everycore-sage100.sage100Trigger.json',
		translation: sage100TriggerDe,
		description: new Sage100Trigger().description,
	},
];

describe.each(cases)('German translation of $fileName', ({ fileName, translation, description }) => {
	it('is named after the whole node type', () => {
		// n8n strips only its own `n8n-nodes-base.` prefix, so a community node's
		// file carries the package name as well.
		expect(fileName).toBe(`${PACKAGE}.${description.name}.json`);
	});

	it('translates the node itself', () => {
		const header = translation.header as { displayName?: string; description?: string } | undefined;
		expect(header?.displayName).toBeTruthy();
		expect(header?.description).toBeTruthy();
	});

	it('covers every key the node shows and no others', () => {
		const wanted = new Set(keysOf(description.properties));
		const have = new Set(Object.keys(translation).filter((key) => key !== 'header'));

		const missing = [...wanted].filter((key) => !have.has(key));
		const stale = [...have].filter((key) => !wanted.has(key));

		expect(missing, 'keys without a translation').toEqual([]);
		expect(stale, 'translations for keys the node no longer has').toEqual([]);
	});

	it('has no empty translation', () => {
		const empty = Object.entries(translation)
			.filter(([key]) => key !== 'header')
			.filter(([, value]) => typeof value !== 'string' || value.trim() === '')
			.map(([key]) => key);

		expect(empty).toEqual([]);
	});
});
