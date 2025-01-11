import axios from "axios";
import crypto from "crypto";

export class AirtableAuthService {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private accessToken: string | null = null;
    private codeVerifier: string | null = null;

    constructor(clientId: string, clientSecret: string, redirectUri: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    /**
     * Generate a code verifier for PKCE
     */
    private generateCodeVerifier(): string {
        return crypto.randomBytes(32).toString("base64url");
    }

    /**
     * Generate a code challenge from the code verifier
     */
    private async generateCodeChallenge(verifier: string): Promise<string> {
        const hash = crypto.createHash("sha256");
        hash.update(verifier);
        return hash.digest("base64url");
    }

    /**
     * Get the URL to redirect users to for OAuth authorization
     */
    async getAuthorizationUrl(state: string): Promise<string> {
        // Generate and store code verifier
        this.codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(
            this.codeVerifier,
        );

        const baseUrl = "https://airtable.com/oauth2/v1/authorize";
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: "code",
            scope:
                "data.records:read data.records:write schema.bases:read schema.bases:write",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
        });
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Exchange an authorization code for an access token
     */
    async exchangeCodeForToken(code: string): Promise<string> {
        if (!this.codeVerifier) {
            throw new Error(
                "No code verifier found. Please start the OAuth flow again.",
            );
        }

        const tokenUrl = "https://airtable.com/oauth2/v1/token";
        const basicAuth = Buffer.from(
            `${this.clientId}:${this.clientSecret}`,
        ).toString("base64");

        const response = await axios.post(
            tokenUrl,
            new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: this.redirectUri,
                code_verifier: this.codeVerifier,
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Basic ${basicAuth}`,
                },
            },
        );

        if (!response.data.access_token) {
            throw new Error("No access token received from Airtable");
        }

        const accessToken = response.data.access_token;
        if (typeof accessToken !== "string") {
            throw new Error("Invalid access token received from Airtable");
        }

        this.accessToken = accessToken;
        return accessToken;
    }

    /**
     * Get the current access token
     */
    getAccessToken(): string | null {
        return this.accessToken;
    }

    /**
     * Set an access token (useful when loading from persistent storage)
     */
    setAccessToken(token: string) {
        this.accessToken = token;
    }
}
