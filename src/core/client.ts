export type AirClientOptions = {
	baseUrl: string;
	defaultToken?: string;
	retrieveAuthToken: () => string;
};

interface ApiOptions extends RequestInit {
	headers?: HeadersInit;
}

export class Air {
	private baseUrl: string;
	private defaultAuthToken: string;
	private retrieveAuthToken: () => string;

	constructor(options: AirClientOptions) {
		this.baseUrl = options.baseUrl;
		this.defaultAuthToken = options.defaultToken || '';
		this.retrieveAuthToken = options.retrieveAuthToken;
	}

	private createHeaders(options: ApiOptions = {}, accessToken: string = ''): HeadersInit {
		const localToken = this.retrieveAuthToken();
		const token =
			localToken && localToken !== '' ? localToken : accessToken || this.defaultAuthToken;

		const isFormData = options.body instanceof FormData;

		return {
			...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...options.headers
		};
	}

	private async handleResponse<T>(response: Response): Promise<T> {
		const responseData = await response.json();

		if (response.ok) {
			return responseData as T;
		}

		throw responseData;
	}

	private prepareRequestBody(data: any): any {
		if (data instanceof FormData) {
			return data;
		}

		if (data === undefined) {
			return undefined;
		}

		return JSON.stringify(data);
	}

	private async request<T = any>(
		endpoint: string,
		options: ApiOptions = {},
		accessToken: string = ''
	): Promise<T> {
		try {
			const headers = this.createHeaders(options, accessToken);
			const url = `${this.baseUrl}${endpoint}`;

			const response = await fetch(url, {
				...options,
				headers
			});

			return this.handleResponse<T>(response);
		} catch (error) {
			throw error;
		}
	}

	get<T = any>(endpoint: string, options?: ApiOptions, token?: string): Promise<T> {
		return this.request<T>(endpoint, { ...options, method: 'GET' }, token);
	}

	post<T = any, D = any>(
		endpoint: string,
		data?: D,
		options?: ApiOptions,
		token?: string
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				...options,
				method: 'POST',
				body: this.prepareRequestBody(data)
			},
			token
		);
	}

	put<T = any, D = any>(
		endpoint: string,
		data?: D,
		options?: ApiOptions,
		token?: string
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				...options,
				method: 'PUT',
				body: this.prepareRequestBody(data)
			},
			token
		);
	}

	patch<T = any, D = any>(
		endpoint: string,
		data?: D,
		options?: ApiOptions,
		token?: string
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				...options,
				method: 'PATCH',
				body: this.prepareRequestBody(data)
			},
			token
		);
	}

	delete<T = any, D = any>(
		endpoint: string,
		data?: D,
		options?: ApiOptions,
		token?: string
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				...options,
				method: 'DELETE',
				body: this.prepareRequestBody(data)
			},
			token
		);
	}
}
