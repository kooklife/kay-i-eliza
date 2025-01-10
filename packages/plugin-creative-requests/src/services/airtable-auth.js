"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirtableAuthService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));

class AirtableAuthService {
    constructor(clientId, clientSecret, redirectUri) {
        this.accessToken = null;
        this.codeVerifier = null;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    generateCodeVerifier() {
        return crypto_1.default.randomBytes(32).toString("base64url");
    }

    generateCodeChallenge(verifier) {
        const hash = crypto_1.default.createHash("sha256");
        hash.update(verifier);
        return hash.digest("base64url");
    }

    getAuthorizationUrl() {
        return __awaiter(this, void 0, void 0, function* () {
            const baseUrl = "https://airtable.com/oauth2/v1/authorize";
            this.codeVerifier = this.generateCodeVerifier();
            const codeChallenge = this.generateCodeChallenge(this.codeVerifier);

            const params = new URLSearchParams({
                client_id: this.clientId,
                redirect_uri: this.redirectUri,
                response_type: "code",
                scope: "data.records:read data.records:write schema.bases:read",
                code_challenge: codeChallenge,
                code_challenge_method: "S256"
            });

            return `${baseUrl}?${params.toString()}`;
        });
    }

    exchangeCodeForToken(code) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.codeVerifier) {
                throw new Error("No code verifier found. Please start the OAuth flow again.");
            }

            const tokenUrl = "https://airtable.com/oauth2/v1/token";
            const response = yield axios_1.default.post(
                tokenUrl,
                new URLSearchParams({
                    grant_type: "authorization_code",
                    code: code,
                    redirect_uri: this.redirectUri,
                    code_verifier: this.codeVerifier
                }),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": "Basic " + Buffer.from(this.clientId + ":" + this.clientSecret).toString("base64")
                    }
                }
            );

            if (!response.data.access_token) {
                throw new Error("No access token received from Airtable");
            }

            this.accessToken = response.data.access_token;
            return this.accessToken;
        });
    }

    getAccessToken() {
        return this.accessToken;
    }

    setAccessToken(token) {
        this.accessToken = token;
    }
}
exports.AirtableAuthService = AirtableAuthService;
