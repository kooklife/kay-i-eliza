"use strict";
import Airtable from "airtable";
import { AirtableAuthService } from "./airtable-auth.js";

export class AirtableService {
    constructor(clientId, clientSecret, redirectUri, baseId, tableName) {
        this.tableName = tableName;
        this.authService = new AirtableAuthService(clientId, clientSecret, redirectUri);
        // Initialize Airtable base without token - will be set when authenticated
        this.base = new Airtable().base(baseId);
    }

    /**
     * Initialize the Airtable connection with an access token
     */
    setAccessToken(token) {
        this.authService.setAccessToken(token);
        this.base = new Airtable({ apiKey: token }).base(this.base.getId());
    }

    /**
     * Get the auth service for OAuth flow
     */
    getAuthService() {
        return this.authService;
    }

    /**
     * Create a new request in Airtable
     */
    async createRequest(request) {
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
    async getRequest(id) {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        try {
            const record = await this.base(this.tableName).find(id);
            return this.recordToRequest(record);
        } catch (error) {
            if (error.error === "NOT_FOUND") {
                return null;
            }
            throw error;
        }
    }

    /**
     * Convert an Airtable record to a CreativeRequest
     */
    recordToRequest(record) {
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
    async listRequests(filterByFormula) {
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
    async updateRequest(id, updates) {
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
    async deleteRequest(id) {
        const token = this.authService.getAccessToken();
        if (!token) {
            throw new Error("Not authenticated with Airtable");
        }

        await this.base(this.tableName).destroy(id);
    }
}
