export type AirClientOptions = {
	baseUrl: string;
	defaultToken?: string;
	retrieveAuthToken: () => string;
};
