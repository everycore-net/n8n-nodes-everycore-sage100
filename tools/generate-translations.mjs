/**
 * Builds and refreshes the German translation files for the nodes.
 *
 * n8n resolves a node translation as
 * `<dir of the node file>/translations/<locale>/<full node type>.json`, and it
 * only strips its own `n8n-nodes-base.` prefix — so for a community package the
 * file name is the whole type, package and node: sage100 twice over. It is read
 * only when the instance runs with a locale other than `en`
 * (`N8N_DEFAULT_LOCALE=de`), and every missing key falls back to English, which
 * is what makes a partial translation harmless.
 *
 * The generator never overwrites a translated value. It adds the keys a node has
 * grown, drops the ones it lost, and reports what is still untranslated — the
 * point being that a new parameter cannot slip into a German instance in English
 * without somebody being told.
 *
 *   npm run translations
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LOCALE = 'de';

/** Everything a user reads, flattened into the dotted keys n8n expects. */
function keysOf(properties, prefix = 'nodeView') {
	const keys = [];
	for (const property of properties ?? []) {
		const base = `${prefix}.${property.name}`;
		for (const field of ['displayName', 'description', 'placeholder']) {
			if (property[field]) keys.push([`${base}.${field}`, property[field]]);
		}
		if (property.typeOptions?.multipleValueButtonText) {
			keys.push([`${base}.multipleValueButtonText`, property.typeOptions.multipleValueButtonText]);
		}
		for (const option of property.options ?? []) {
			if (option.value !== undefined) {
				// An entry in a dropdown.
				keys.push([`${base}.options.${option.value}.name`, option.name]);
				if (option.description) {
					keys.push([`${base}.options.${option.value}.description`, option.description]);
				}
			} else {
				// A collection or fixedCollection: a named group of further fields.
				keys.push([`${base}.options.${option.name}.displayName`, option.displayName ?? option.name]);
				keys.push(...keysOf(option.values ?? option.options ?? [], `${base}.options.${option.name}`));
			}
		}
	}
	return keys;
}

const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
const nodesDir = join(root, 'dist', 'nodes');

if (!existsSync(nodesDir)) {
	console.error('Build first: the translations are derived from the compiled node descriptions.');
	process.exit(1);
}

let missingTotal = 0;

for (const dir of readdirSync(nodesDir)) {
	const entry = readdirSync(join(nodesDir, dir)).find((file) => file.endsWith('.node.js'));
	if (entry === undefined) continue;

	const module = await import(`file:///${join(nodesDir, dir, entry).replace(/\\/g, '/')}`);
	const NodeClass = Object.values(module).find((value) => typeof value === 'function');
	const description = new NodeClass().description;

	const wanted = new Map(keysOf(description.properties));
	const target = join(root, 'nodes', dir, 'translations', LOCALE, `${packageName}.${description.name}.json`);

	const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
	const merged = {
		header: {
			displayName: existing.header?.displayName ?? description.displayName,
			description: existing.header?.description ?? description.description,
		},
	};

	const missing = [];
	for (const [key, english] of wanted) {
		if (existing[key] !== undefined) {
			merged[key] = existing[key];
			continue;
		}
		merged[key] = english;
		missing.push(key);
	}

	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

	const dropped = Object.keys(existing).filter((key) => key !== 'header' && !wanted.has(key));
	missingTotal += missing.length;
	console.log(
		`${description.name}: ${wanted.size} keys, ${missing.length} still English, ${dropped.length} dropped -> ${target.slice(root.length)}`,
	);
}

if (missingTotal > 0) {
	console.log(`\n${missingTotal} keys carry their English text. Translate them in place; the generator keeps whatever it finds.`);
}
