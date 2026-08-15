import { createHmac, timingSafeEqual } from 'node:crypto';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

/**
 * Receives events pushed by a webhook channel of the Task Service.
 *
 * The service signs with HMAC-SHA256 over "<timestamp>.<body>" and sends
 * X-EVC-Timestamp (Unix seconds) plus X-EVC-Signature: sha256=<hex>. Both the
 * signature and the age of the timestamp are checked here - the signature alone
 * would let an intercepted request be replayed forever.
 *
 * Verification needs the body exactly as it was signed, so the webhook is
 * registered with rawBody and the JSON is parsed afterwards.
 */
export class Sage100Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sage 100 Trigger',
		name: 'sage100Trigger',
		icon: 'file:sage100.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"]}}',
		description: 'Starts a workflow when the Sage 100 Task Service sends an event',
		defaults: {
			name: 'Sage 100 Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sage100WebhookApi',
				required: false,
				displayOptions: {
					show: {
						verifySignature: [true],
					},
				},
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
				rawBody: true,
			},
		],
		properties: [
			{
				displayName:
					'Set the webhook URL below as WebhookUrl of a channel in the Task Service under Settings -> Communication.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description:
					'Whether to require and check the HMAC signature. Turn this off only for a channel with AuthMode=None on a trusted network — an unsigned webhook can be sent by anyone who knows the URL',
			},
			{
				displayName: 'Tolerance (Seconds)',
				name: 'tolerance',
				type: 'number',
				default: 300,
				typeOptions: { minValue: 0 },
				description:
					'How far the timestamp of a request may lie from the current time. 0 disables the age check, which also disables replay protection',
				displayOptions: { show: { verifySignature: [true] } },
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'string',
				default: '',
				placeholder: 'belegAngelegt,aufgabeFehlgeschlagen',
				description:
					'Comma separated list of event names to let through, matched against the ereignis field. Empty accepts every event',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const headers = this.getHeaderData() as IDataObject;
		const verify = this.getNodeParameter('verifySignature', true) as boolean;

		// rawBody gives the bytes as signed; parsing first and re-serialising
		// would change key order and whitespace and break every signature.
		const raw = (request as unknown as { rawBody?: Buffer }).rawBody;
		const body = raw ? raw.toString('utf8') : '';

		if (verify) {
			const credentials = await this.getCredentials('sage100WebhookApi');
			const secret = credentials.secret as string;
			const headerName = ((credentials.signatureHeader as string) || 'X-EVC-Signature').toLowerCase();
			const tolerance = this.getNodeParameter('tolerance', 300) as number;

			const signature = headers[headerName] as string | undefined;
			const timestamp = headers['x-evc-timestamp'] as string | undefined;

			if (!signature || !timestamp) {
				throw new NodeOperationError(
					this.getNode(),
					`Request carries no signature: ${headerName} and X-EVC-Timestamp are required. Set AuthMode=Hmac on the channel, or switch Verify Signature off.`,
				);
			}

			const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

			const givenBytes = Buffer.from(signature);
			const expectedBytes = Buffer.from(expected);
			if (givenBytes.length !== expectedBytes.length || !timingSafeEqual(givenBytes, expectedBytes)) {
				throw new NodeOperationError(this.getNode(), 'Signature does not match the shared secret');
			}

			if (tolerance > 0) {
				const sent = Number.parseInt(timestamp, 10);
				const age = Math.abs(Math.floor(Date.now() / 1000) - sent);
				if (!Number.isFinite(sent) || age > tolerance) {
					throw new NodeOperationError(
						this.getNode(),
						`Timestamp is ${age} seconds off, tolerance is ${tolerance}. Either this is a replayed request or the clocks differ.`,
					);
				}
			}
		}

		let payload: IDataObject;
		try {
			payload = body ? (JSON.parse(body) as IDataObject) : {};
		} catch {
			throw new NodeOperationError(
				this.getNode(),
				'Body is not valid JSON. A channel with a custom Template has to produce JSON for this trigger.',
			);
		}

		const accepted = (this.getNodeParameter('events', '') as string)
			.split(',')
			.map((event) => event.trim())
			.filter((event) => event !== '');

		if (accepted.length > 0) {
			const event = (payload.ereignis as string) ?? '';
			if (!accepted.includes(event)) {
				// Answer 200 without starting the workflow: an error would make the
				// service retry an event this workflow deliberately ignores.
				return {};
			}
		}

		return {
			workflowData: [this.helpers.returnJsonArray([payload])],
		};
	}
}
