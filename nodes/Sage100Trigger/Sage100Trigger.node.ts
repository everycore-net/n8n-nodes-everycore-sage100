import { createHmac, timingSafeEqual } from 'node:crypto';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	IHookFunctions,
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
 *
 * When "Manage Channel" is on, activating the workflow creates the channel in
 * the service and deactivating removes it again. That needs an API key with the
 * Settings permission. Turn it off to point an existing, hand-made channel at
 * this trigger instead.
 */
export class Sage100Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sage 100 Trigger',
		name: 'sage100Trigger',
		icon: { light: 'file:sage100.svg', dark: 'file:sage100.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"]}}',
		description: 'Starts a workflow when the Sage 100 Task Service sends an event',
		defaults: {
			name: 'Sage 100 Trigger',
		},
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sage100TaskServiceApi',
				required: true,
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
				displayName: 'Manage Channel',
				name: 'manageChannel',
				type: 'boolean',
				default: true,
				description:
					'Whether to create the webhook channel in the service when the workflow is activated and remove it again when it is deactivated. Needs an API key with the Settings permission. Switch it off to use a channel you configured by hand.',
			},
			{
				displayName:
					'Set the production webhook URL of this node as WebhookUrl of a channel in the service under Settings -> Communication, with AuthMode=Hmac and the same secret as in the credentials.',
				name: 'manualNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { manageChannel: [false] } },
			},
			{
				displayName: 'Purposes',
				name: 'zweck',
				type: 'multiOptions',
				default: ['Allgemein'],
				description: 'Which kinds of message the channel should receive',
				options: [
					{ name: 'Allgemein', value: 'Allgemein' },
					{ name: 'Ablage', value: 'Ablage' },
					{ name: 'Belegversand', value: 'Belegversand' },
					{ name: 'Fehler', value: 'Fehler' },
				],
				displayOptions: { show: { manageChannel: [true] } },
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description:
					'Whether to require and check the HMAC signature. Turn this off only for a channel with AuthMode=None on a trusted network — an unsigned webhook can be sent by anyone who knows the URL.',
			},
			{
				displayName: 'Tolerance (Seconds)',
				name: 'tolerance',
				type: 'number',
				default: 300,
				typeOptions: { minValue: 0 },
				description:
					'How far the timestamp of a request may lie from the current time. 0 disables the age check, which also disables replay protection.',
				displayOptions: { show: { verifySignature: [true] } },
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'string',
				default: '',
				placeholder: 'belegAngelegt,aufgabeFehlgeschlagen',
				description:
					'Comma-separated list of event names to let through, matched against the ereignis field. Empty accepts every event.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				if (!(this.getNodeParameter('manageChannel', true) as boolean)) return true;

				const wanted = channelName(this);
				const list = (await request(this, 'GET', '/api/kommunikation/kanaele')) as IDataObject;
				const channels = (list.kanaele as IDataObject[]) ?? [];

				const found = channels.find((channel) => channel.name === wanted);
				if (found === undefined) return false;

				// A channel with our name but pointing somewhere else is stale, for
				// example after the tunnel URL changed. Report it as missing so that
				// create() writes the current address.
				const settings = (found.einstellungen as IDataObject) ?? {};
				return settings.WebhookUrl === this.getNodeWebhookUrl('default');
			},

			async create(this: IHookFunctions): Promise<boolean> {
				if (!(this.getNodeParameter('manageChannel', true) as boolean)) return true;

				const credentials = await this.getCredentials('sage100TaskServiceApi');
				const secret = (credentials.webhookSecret as string) ?? '';
				if (secret === '') {
					throw new NodeOperationError(
						this.getNode(),
						'Webhook Secret is empty in the credentials. Set one there, or switch Manage Channel off and configure the channel by hand.',
					);
				}

				await request(this, 'POST', '/api/kommunikation/speichern', {
					name: channelName(this),
					typ: 'Webhook',
					enabled: true,
					zweck: this.getNodeParameter('zweck', ['Allgemein']) as string[],
					einstellungen: {
						WebhookUrl: this.getNodeWebhookUrl('default'),
						AuthMode: 'Hmac',
						Secret: secret,
						SignatureHeader:
							(credentials.webhookSignatureHeader as string) || 'X-EVC-Signature',
					},
				});
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				if (!(this.getNodeParameter('manageChannel', true) as boolean)) return true;

				try {
					await request(this, 'POST', '/api/kommunikation/loeschen', { name: channelName(this) });
				} catch (error) {
					// Deactivating a workflow must not fail because the channel was
					// already removed in the service - but it must not disappear
					// silently either, or a stale channel keeps sending into nothing.
					this.logger.warn(
						`Sage 100 Trigger: could not remove the channel ${channelName(this)}: ${(error as Error).message}`,
					);
					return false;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const incoming = this.getRequestObject();
		const headers = this.getHeaderData() as IDataObject;
		const verify = this.getNodeParameter('verifySignature', true) as boolean;

		// rawBody gives the bytes as signed; parsing first and re-serialising
		// would change key order and whitespace and break every signature.
		const raw = (incoming as unknown as { rawBody?: Buffer }).rawBody;
		const body = raw ? raw.toString('utf8') : '';

		if (verify) {
			const credentials = await this.getCredentials('sage100TaskServiceApi');
			const secret = (credentials.webhookSecret as string) ?? '';
			const headerName = (
				(credentials.webhookSignatureHeader as string) || 'X-EVC-Signature'
			).toLowerCase();
			const tolerance = this.getNodeParameter('tolerance', 300) as number;

			const signature = headers[headerName] as string | undefined;
			const timestamp = headers['x-evc-timestamp'] as string | undefined;

			if (signature === undefined || timestamp === undefined) {
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
			payload = body === '' ? {} : (JSON.parse(body) as IDataObject);
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

		if (accepted.length > 0 && !accepted.includes((payload.ereignis as string) ?? '')) {
			// Answer 200 without starting the workflow: an error would make the
			// service retry an event this workflow deliberately ignores.
			return {};
		}

		return {
			workflowData: [this.helpers.returnJsonArray([payload])],
		};
	}
}

/**
 * Deterministic channel name, so that a re-activated workflow finds its own
 * channel again instead of creating a second one.
 */
function channelName(context: IHookFunctions): string {
	const node = context.getNode().name.replace(/[^A-Za-z0-9]+/g, '-');
	return `n8n-${context.getWorkflow().id ?? 'workflow'}-${node}`;
}

async function request(
	context: IHookFunctions,
	method: 'GET' | 'POST',
	url: string,
	body?: IDataObject,
): Promise<unknown> {
	const credentials = await context.getCredentials('sage100TaskServiceApi');
	return await context.helpers.httpRequestWithAuthentication.call(
		context,
		'sage100TaskServiceApi',
		{
			method,
			baseURL: credentials.baseUrl as string,
			url,
			body,
			json: true,
			skipSslCertificateValidation: credentials.ignoreSslIssues as boolean,
		},
	);
}
