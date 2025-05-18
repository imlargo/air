import { AirClientOptions } from '@/types/api.types';

// Definición de tipos para el formato de error del backend
interface ApiErrorResponse {
	code: string;
	message: string;
	payload?: Record<string, any>;
}

interface ApiOptions extends RequestInit {
	headers?: HeadersInit;
}

export class Air {
	private baseUrl: string;
	private defaultAuthToken: string;
	private retrieveAuthToken: () => string;

	/**
	 * Construye un nuevo cliente API
	 * @param baseUrl URL base para todas las peticiones
	 * @param defaultToken Token de autenticación por defecto
	 */
	constructor(options: AirClientOptions) {
		this.baseUrl = options.baseUrl;
		this.defaultAuthToken = options.defaultToken || '';
		this.retrieveAuthToken = options.retrieveAuthToken;
	}

	/**
	 * Crea los headers para la petición con autenticación
	 */
	private createHeaders(options: ApiOptions = {}, accessToken: string = ''): HeadersInit {
		const localToken = this.retrieveAuthToken();
		const token =
			localToken && localToken !== '' ? localToken : accessToken || this.defaultAuthToken;

		// Verificar si el body es FormData para no enviar Content-Type
		const isFormData = options.body instanceof FormData;

		return {
			// Solo añadir Content-Type si no es FormData
			...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...options.headers
		};
	}

	/**
	 * Procesa la respuesta de la API
	 */
	private async handleResponse<T>(response: Response): Promise<T> {
		const responseData = await response.json();

		// Si es una respuesta exitosa, devolver los datos directamente
		if (response.ok) {
			return responseData as T;
		}

		// Si hay error, utilizar el formato específico del backend
		const error: ApiErrorResponse = {
			code: responseData.code || 'UNKNOWN_ERROR',
			message: responseData.message || 'An unknown error occurred',
			payload: responseData.payload
		};

		throw error;
	}

	/**
	 * Prepara el cuerpo de la petición según su tipo
	 */
	private prepareRequestBody(data: any): any {
		// Si es FormData, devolverlo tal cual
		if (data instanceof FormData) {
			return data;
		}

		// Si es undefined, devolverlo tal cual
		if (data === undefined) {
			return undefined;
		}

		// Para otros tipos de datos, convertir a JSON
		return JSON.stringify(data);
	}

	/**
	 * Cliente API principal con soporte para tipado genérico
	 */
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
			// Si es un error de red (no un error de API)
			if (error instanceof Error && !(error as any).code) {
				throw {
					code: 'NETWORK_ERROR',
					message: error.message,
					payload: { originalError: error.toString() }
				} as ApiErrorResponse;
			}
			// Re-lanzar si ya es un ApiErrorResponse
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
