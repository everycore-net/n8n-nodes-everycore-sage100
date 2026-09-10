import type { INodeProperties } from 'n8n-workflow';

const show = { resource: ['vorgang'] };

export const vorgangOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		default: 'getAll',
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many transactions',
				description: 'List sales transactions',
				routing: {
					request: { method: 'GET', url: '/api/vorgaenge/list' },
					output: { postReceive: [{ type: 'rootProperty', properties: { property: 'rows' } }] },
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a transaction',
				description: 'Read one transaction with the documents belonging to it',
				routing: { request: { method: 'GET', url: '/api/vorgaenge/detail' } },
			},
			{
				name: 'Get Positions',
				value: 'getPositions',
				action: 'Get the positions of a transaction',
				description: 'Read the positions of one transaction',
				routing: {
					request: { method: 'GET', url: '/api/vorgaenge/positionen' },
					output: { postReceive: [{ type: 'rootProperty', properties: { property: 'rows' } }] },
				},
			},
		],
	},
];

export const vorgangFields: INodeProperties[] = [
	{
		displayName: 'Transaction ID',
		name: 'vorId',
		type: 'number',
		required: true,
		default: 0,
		description: 'VorID of the transaction (KHKVKVorgaenge.VorID)',
		displayOptions: { show: { ...show, operation: ['get', 'getPositions'] } },
		routing: { request: { qs: { vorId: '={{$value}}' } } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { ...show, operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 500 },
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, operation: ['getAll'], returnAll: [false] } },
		routing: { request: { qs: { take: '={{$value}}' } } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...show, operation: ['getAll'] } },
		options: [
			{
				displayName: 'Search',
				name: 'suche',
				type: 'string',
				default: '',
				description: 'Free text over recipient, match code, name and VorID',
				routing: { request: { qs: { suche: '={{$value}}' } } },
			},
			{
				displayName: 'Custom Filter (JSON)',
				name: 'custom',
				type: 'string',
				default: '',
				placeholder: '[{"feld":"Vorgang.Empfaenger","wert":"D100002"}]',
				description: 'JSON array of {feld, wert, bis} over the transaction filter catalogue',
				routing: { request: { qs: { custom: '={{$value}}' } } },
			},
			{
				displayName: 'Columns',
				name: 'spalten',
				type: 'string',
				default: '',
				description: 'Comma-separated list of columns to return',
				routing: { request: { qs: { spalten: '={{$value}}' } } },
			},
		],
	},
];
