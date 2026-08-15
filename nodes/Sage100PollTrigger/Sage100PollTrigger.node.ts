import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

/**
 * Polls the Task Service for new sales documents.
 *
 * This is the fallback for installations where the service cannot reach n8n,
 * so the webhook trigger is not an option. Where it can, prefer
 * "Sage 100 Trigger": it has no polling delay and no watermark to lose.
 *
 * The watermark is the highest BelID seen so far, kept in the node's static
 * data. That is deliberately a *new document* trigger and not a *changed
 * document* one: BelIDs only grow, but an edit to an existing document does not
 * change its BelID, so an edit will not fire this trigger.
 */
export class Sage100PollTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sage 100 Poll Trigger',
		name: 'sage100PollTrigger',
		icon: 'file:sage100.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{"New sales documents"}}',
		description: 'Starts a workflow for sales documents that appeared since the last run',
		defaults: {
			name: 'Sage 100 Poll Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sage100TaskServiceApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'Fires for documents whose BelID is higher than the highest one seen before. Changes to existing documents do not fire it — use the webhook trigger for those.',
				name: 'behaviourNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Batch Size',
				name: 'batchSize',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 1, maxValue: 500 },
				description:
					'How many documents to read per poll. Raise it if more documents can appear between two polls than fit in one batch',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				options: [
					{
						displayName: 'Document Type Key',
						name: 'belegkennzeichen',
						type: 'string',
						default: '',
						description: 'Only documents with this Belegkennzeichen, for example VFR',
					},
					{
						displayName: 'Customer Group',
						name: 'kundengruppe',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Custom Filter (JSON)',
						name: 'custom',
						type: 'string',
						default: '',
						description: 'JSON array of {feld, wert, bis} over the document filter catalogue',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('sage100TaskServiceApi');
		const staticData = this.getWorkflowStaticData('node');
		const filters = this.getNodeParameter('filters', {}) as IDataObject;
		const batchSize = this.getNodeParameter('batchSize', 100) as number;
		const manual = this.getMode() === 'manual';

		const qs: IDataObject = {
			take: batchSize,
			sort: 'BelID',
			dir: 'desc',
		};
		if (filters.belegkennzeichen) qs.Belegkennzeichen = filters.belegkennzeichen;
		if (filters.kundengruppe) qs.Kundengruppe = filters.kundengruppe;
		if (filters.custom) qs.custom = filters.custom;

		let response: IDataObject;
		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'sage100TaskServiceApi',
				{
					method: 'GET',
					baseURL: credentials.baseUrl as string,
					url: '/api/belege/list',
					qs,
					json: true,
					skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
				},
			)) as IDataObject;
		} catch (error) {
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		const rows = (response.rows as IDataObject[]) ?? [];
		if (rows.length === 0) return null;

		const highest = rows.reduce((max, row) => Math.max(max, Number(row.belId) || 0), 0);

		// A manual run is a test: show what the trigger would deliver without
		// consuming the watermark, otherwise testing once would swallow the
		// documents the first real run should have picked up.
		if (manual) {
			return [this.helpers.returnJsonArray(rows)];
		}

		const seen = (staticData.lastBelId as number) ?? 0;

		// First run after activation: remember where we are and deliver nothing.
		// Without this every existing document would flood the workflow once.
		if (seen === 0) {
			staticData.lastBelId = highest;
			return null;
		}

		const fresh = rows.filter((row) => (Number(row.belId) || 0) > seen);
		if (fresh.length === 0) return null;

		staticData.lastBelId = highest;

		// Oldest first: a workflow that creates follow-ups should see them in the
		// order they were created.
		fresh.sort((left, right) => (Number(left.belId) || 0) - (Number(right.belId) || 0));

		return [this.helpers.returnJsonArray(fresh)];
	}
}
