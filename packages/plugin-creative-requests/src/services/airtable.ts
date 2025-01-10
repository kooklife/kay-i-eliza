import Airtable from "airtable";
import { CreativeRequest } from "../types.js";
import { AirtableAuthService } from "./airtable-auth.js";

export class AirtableService {
    private base: Airtable.Base;
    private tableName: string;
    private authService: AirtableAuthService;

    constructor(
        clientId: string,
        clientSecret: string,
        redirectUri: string,
        baseId: string,
        tableName: string,
    ) {
        this.tableName = tableName;
        this.authService = new AirtableAuthService(
            clientId,
            clientSecret,
            redirectUri,
        );

        // Initialize Airtable base with a dummy token that will be replaced
        this.base = new Airtable({ apiKey: "dummy" }).base(baseId);
    }

    /**
     * Initialize the Airtable connection with an access token
     */
    setAccessToken(token: string) {
        this.authService.setAccessToken(token);
        this.base = new Airtable({ apiKey: token }).base(this.base.getId());
    }

    /**
     * Get the auth service for OAuth flow
     */
    getAuthService(): AirtableAuthService {
        return this.authService;
    }

    /**
     * Create a new request in Airtable
     */
    async createRequest(request: CreativeRequest): Promise<string> {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        const record = await this.base(this.tableName).create({
            Status: "Not started",
            Deliverable: request.structured_content.brief,
            Description: request.raw_content,
            "Start date": new Date().toISOString().split("T")[0],
            // Map other fields as needed
        });

        return record.getId();
    }

    /**
     * Get a request by its ID
     */
    async getRequest(id: string): Promise<CreativeRequest | null> {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        try {
            const record = await this.base(this.tableName).find(id);
            return this.recordToRequest(record);
        } catch (error) {
            if ((error as any).error === "NOT_FOUND") {
                return null;
            }
            throw error;
        }
    }

    /**
     * Convert an Airtable record to a CreativeRequest
     */
    private recordToRequest(record: Airtable.Record<any>): CreativeRequest {
        const fields = record.fields;
        return {
            id: record.getId(),
            raw_content: fields.Description || "",
            structured_content: {
                brief: fields.Deliverable || "",
                requirements: [],
                notes: [],
                keywords: [],
            },
            metadata: {
                type: "creative",
                status: fields.Status?.toLowerCase() || "new",
                priority: "normal",
                source: "airtable",
            },
            created_at: record.fields["Start date"] || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
    }

    /**
     * List all requests, optionally filtered
     */
    async listRequests(filterByFormula?: string): Promise<CreativeRequest[]> {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        const records = await this.base(this.tableName)
            .select({ filterByFormula })
            .firstPage();

        return records.map((record) => this.recordToRequest(record));
    }

    /**
     * Update an existing request
     */
    async updateRequest(
        id: string,
        updates: Partial<CreativeRequest>,
    ): Promise<void> {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        await this.base(this.tableName).update(id, {
            Status: updates.metadata?.status?.toUpperCase(),
            Deliverable: updates.structured_content?.brief,
            Description: updates.raw_content,
            // Map other fields as needed
        });
    }

    /**
     * Delete a request
     */
    async deleteRequest(id: string): Promise<void> {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        await this.base(this.tableName).destroy(id);
    }
}
