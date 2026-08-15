import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Shared secret of one webhook channel of the Task Service.
 *
 * This is deliberately separate from the API key: the key says who may call
 * the service, this secret proves that an incoming request really came from
 * the service. They belong to different directions and are rotated
 * independently.
 *
 * Set the channel to AuthMode=Hmac in the service under
 * Settings -> Communication and use the same secret here.
 */
export class Sage100WebhookApi implements ICredentialType {
	name = 'sage100WebhookApi';

	displayName = 'Sage 100 Webhook Secret';

	documentationUrl = 'https://everycore.net';

	properties: INodeProperties[] = [
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The value of the Secret setting of the webhook channel',
		},
		{
			displayName: 'Signature Header',
			name: 'signatureHeader',
			type: 'string',
			default: 'X-EVC-Signature',
			description:
				'Header carrying the signature. Change it only if the channel sets SignatureHeader to something else',
		},
	];
}
