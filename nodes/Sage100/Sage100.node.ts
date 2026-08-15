import { NodeConnectionTypes } from 'n8n-workflow';
import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

import { artikelFields, artikelOperations } from './descriptions/ArtikelDescription';
import { belegFields, belegOperations } from './descriptions/BelegDescription';
import { vorgangFields, vorgangOperations } from './descriptions/VorgangDescription';

/**
 * Action node for the everycore Sage 100 Task Service.
 *
 * Declarative style: every operation is a route, no custom transport code. The
 * service answers plain JSON and reports every error as { "error": "..." } with
 * the German message a user would see in the interface, so the message n8n
 * shows on failure is the one the customer will quote back.
 *
 * The dataset a call works on comes from the credentials as the X-Dataset
 * header. A key bound to one Mandant rejects a deviating value rather than
 * silently overriding it.
 */
export class Sage100 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sage 100',
		name: 'sage100',
		icon: 'file:sage100.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with sales documents, transactions and articles in Sage 100',
		defaults: {
			name: 'Sage 100',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sage100TaskServiceApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'beleg',
				options: [
					{
						name: 'Sales Document',
						value: 'beleg',
						description: 'Belege: read, create, change, print and check',
					},
					{
						name: 'Sales Transaction',
						value: 'vorgang',
						description: 'Vorgänge: read only',
					},
					{
						name: 'Article',
						value: 'artikel',
						description: 'Artikel: read, search and change master data',
					},
				],
			},

			...belegOperations,
			...belegFields,
			...vorgangOperations,
			...vorgangFields,
			...artikelOperations,
			...artikelFields,
		],
	};
}
