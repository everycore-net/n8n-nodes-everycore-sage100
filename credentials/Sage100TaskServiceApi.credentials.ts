import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Connection to one everycore Sage 100 Task Service installation.
 *
 * Authentication is an API key issued in the service under
 * Settings -> API keys. A key is issued for an existing Sage user and can only
 * narrow that user's permissions, never widen them, so the rights shown in the
 * Sage 100 Administrator remain the single source of truth.
 *
 * The key is sent in the Authorization header only. The service rejects keys
 * that arrive in the query string, because URLs end up in server, proxy and
 * browser logs while a key stays valid until it is revoked.
 */
export class Sage100TaskServiceApi implements ICredentialType {
	name = 'sage100TaskServiceApi';

	displayName = 'Sage 100 Task Service API';

	documentationUrl = 'https://everycore.net';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://localhost:8090',
			required: true,
			placeholder: 'https://sage-server:8090',
			description:
				'Address of the Task Service, without a trailing slash. Use HTTPS: an API key is valid until revoked, so sending it over plain HTTP is a great deal worse than a short-lived browser session.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'evc_a1b2c3d4e5f6_...',
			description:
				'Key created under Settings -> API keys. It is shown once when it is created and cannot be recovered afterwards.',
		},
		{
			displayName: 'Dataset',
			name: 'dataset',
			type: 'string',
			default: '',
			placeholder: 'OLReweAbf;1',
			description:
				'Data source and Mandant as "DataSource;Mandant". Leave empty when the key is already bound to one Mandant — the service rejects a deviating value instead of silently overriding it.',
		},
		{
			displayName: 'Ignore SSL Issues',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: false,
			description:
				'Whether to accept an untrusted certificate. Only for the certificate shipped with Sage, which is valid on the intranet but not trusted by the certificate store.',
		},
	];

	/**
	 * An empty X-Dataset header is harmless: the service treats a missing and an
	 * empty value the same way and falls back to its default dataset, and a key
	 * bound to a Mandant accepts an empty header as well.
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'X-Dataset': '={{$credentials.dataset}}',
			},
		},
	};

	/**
	 * Reads the service status. This needs the View permission - a key issued
	 * only for Run will fail this test although it works for its own operations.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/status',
			skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
		},
	};
}
