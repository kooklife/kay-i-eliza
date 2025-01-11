import { createClient } from "@supabase/supabase-js";
import { ExtractionService } from "./services/extraction.js";

interface RequestMetadata {
    type: "social" | "merch" | "logo" | "website" | "creative_writing";
    platform?: "instagram" | "linkedin" | "tiktok";
    status:
        | "new"
        | "processing"
        | "ready_for_review"
        | "approved"
        | "scheduled"
        | "completed"
        | "rejected";
    priority: "high" | "medium" | "low";
    campaign?: string;
    deadline?: string;
    assignee?: string;
    tags?: string[];
    source?: "email" | "text" | "direct" | "api";
    aiProcessed?: boolean;
    lastProcessedAt?: string;
}

interface CreativeRequest {
    id: string;
    raw_content: string;
    structured_content: {
        brief: string;
        requirements: string[];
        notes: string[];
        audience?: string;
        tone?: string;
        keywords?: string[];
        references?: string[];
        dimensions?: Array<{
            value: number;
            unit: string;
        }>;
        colors?: string[];
        materials?: string[];
        sentiment?: {
            score: number;
            confidence: number;
            aspects: Record<string, number>;
        };
        topics?: string[];
        emotions?: Record<string, number>;
        campaignSuggestions?: string[];
    };
    metadata: RequestMetadata;
    created_at: string;
    updated_at: string;
}

interface ProcessingResult {
    success: boolean;
    request?: CreativeRequest;
    error?: string;
    warnings?: string[];
}

interface RequestFeedback {
    requestId: string;
    accuracy: number; // 0-1 score for extraction accuracy
    missingFields: string[];
    incorrectFields: string[];
    suggestedFields: string[];
    userCorrections: Record<string, any>;
    timestamp: string;
}

interface PluginConfig {
    batchProcessingEnabled: boolean;
    batchInterval: number;
    autoSync: boolean;
    maxRetries: number;
    aiProcessingEnabled: boolean;
    learningEnabled: boolean; // Whether to store and learn from feedback
    adaptiveThreshold: number; // Threshold for adapting extraction schema (0-1)
}

interface StructuredContent {
    brief: string;
    notes: string[];
    requirements: string[];
    keywords?: string[];
    topics?: string[];
    type?: string;
}

export class CreativeRequestPlugin {
    private supabase;
    private extractionPatterns: Map<string, Array<RegExp>> = new Map();
    private fieldFrequency: Map<string, Map<string, number>> = new Map();
    private extractionService: ExtractionService;

    constructor(
        private config: PluginConfig = {
            batchProcessingEnabled: true,
            batchInterval: 24 * 60 * 60 * 1000,
            autoSync: true,
            maxRetries: 3,
            aiProcessingEnabled: true,
            learningEnabled: true,
            adaptiveThreshold: 0.7,
        },
    ) {
        this.supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        );

        // Initialize extraction service
        this.extractionService = new ExtractionService(
            process.env.OPENAI_API_KEY || "",
            process.env.HUGGINGFACE_API_KEY || "",
        );

        if (this.config.batchProcessingEnabled) {
            this.startBatchProcessing();
        }

        if (this.config.learningEnabled) {
            this.loadLearnedPatterns();
        }
    }

    // Process new request
    async processRequest(
        rawContent: string,
        source: RequestMetadata["source"] = "direct",
        initialMetadata: Partial<RequestMetadata> = {},
    ): Promise<ProcessingResult> {
        try {
            // Extract structured content using AI
            const structured = await this.extractStructuredContent(rawContent);

            // Determine request type and priority
            const type = await this.determineRequestType(structured);
            const priority = await this.determinePriority(structured);

            // Create request record
            const { data, error } = await this.supabase
                .from("creative_requests")
                .insert({
                    raw_content: rawContent,
                    structured_content: structured,
                    metadata: {
                        status: "new",
                        type,
                        priority,
                        source,
                        aiProcessed: this.config.aiProcessingEnabled,
                        ...initialMetadata,
                    },
                })
                .select()
                .single();

            if (error) throw error;

            // Start processing if not batch mode
            if (!this.config.batchProcessingEnabled) {
                await this.processRequestImmediately(data.id);
            }

            return {
                success: true,
                request: data,
            };
        } catch (error) {
            console.error("Error processing request:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    // Get requests by status
    async getRequestsByStatus(
        status: RequestMetadata["status"],
        limit = 10,
        orderBy: "created_at" | "updated_at" | "priority" = "created_at",
    ) {
        const { data, error } = await this.supabase
            .from("creative_requests")
            .select("*")
            .eq("metadata->status", status)
            .order(orderBy, { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data;
    }

    // Update request status
    async updateRequestStatus(
        requestId: string,
        status: RequestMetadata["status"],
        additionalMetadata: Partial<RequestMetadata> = {},
    ) {
        const { data, error } = await this.supabase
            .from("creative_requests")
            .update({
                metadata: {
                    status,
                    lastProcessedAt: new Date().toISOString(),
                    ...additionalMetadata,
                },
            })
            .eq("id", requestId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    // Search requests
    async searchRequests(query: string) {
        const { data, error } = await this.supabase
            .from("creative_requests")
            .select()
            .textSearch("search_vector", query.split(" ").join(" & "));

        if (error) throw error;
        return data;
    }

    // Process a batch of requests
    private async processBatch() {
        const { data: requests, error } = await this.supabase
            .from("creative_requests")
            .select("*")
            .eq("metadata->status", "new")
            .order("created_at", { ascending: true })
            .limit(10);

        if (error) {
            console.error("Error fetching batch:", error);
            return;
        }

        for (const request of requests) {
            await this.processRequestImmediately(request.id);
        }
    }

    // Process a single request immediately
    private async processRequestImmediately(requestId: string) {
        try {
            // Update status to processing
            await this.updateRequestStatus(requestId, "processing");

            // Get the request
            const { data: request, error } = await this.supabase
                .from("creative_requests")
                .select()
                .eq("id", requestId)
                .single();

            if (error) throw error;

            // Enhance structured content with AI
            if (this.config.aiProcessingEnabled) {
                const enhanced = await this.enhanceStructuredContent(request);
                await this.supabase
                    .from("creative_requests")
                    .update({
                        structured_content: enhanced,
                        metadata: {
                            ...request.metadata,
                            aiProcessed: true,
                        },
                    })
                    .eq("id", requestId);
            }

            // Update status to ready for review
            await this.updateRequestStatus(requestId, "ready_for_review");
        } catch (error) {
            console.error(`Error processing request ${requestId}:`, error);
            await this.updateRequestStatus(requestId, "new", {
                lastProcessedAt: new Date().toISOString(),
                status: "new",
            });
        }
    }

    // Start batch processing
    private startBatchProcessing() {
        setInterval(() => this.processBatch(), this.config.batchInterval);
    }

    // Private helper methods
    private async extractStructuredContent(
        rawContent: string,
    ): Promise<StructuredContent> {
        try {
            // Analyze content using the extraction service
            const analysis = await this.extractionService.analyzeContent(
                rawContent,
            );

            return {
                brief: analysis.brief,
                notes: [
                    analysis.platform
                        ? `Target platform: ${analysis.platform}`
                        : null,
                    analysis.colors.length > 0
                        ? `Colors: ${analysis.colors.join(", ")}`
                        : null,
                    analysis.dimensions.length > 0
                        ? `Dimensions: ${
                            analysis.dimensions.map((d) =>
                                `${d.value}${d.unit}`
                            ).join(", ")
                        }`
                        : null,
                ].filter((note): note is string => note !== null),
                requirements: analysis.requirements,
                keywords: analysis.keywords,
                topics: analysis.topics,
                type: analysis.type,
            };
        } catch (error) {
            console.error("Error extracting structured content:", error);
            return {
                brief: rawContent,
                notes: ["Error during content analysis"],
                requirements: [],
            };
        }
    }

    private getExtractionSchemaForType(type: RequestMetadata["type"]): Array<{
        field: string;
        description: string;
        required: boolean;
        extractFn: (content: string) => any;
    }> {
        const commonFields = [
            {
                field: "brief",
                description: "Main objective or request summary",
                required: true,
                extractFn: (content: string) => content,
            },
            {
                field: "requirements",
                description: "Specific requirements or constraints",
                required: true,
                extractFn: this.extractRequirements.bind(this),
            },
            {
                field: "notes",
                description: "Additional context or notes",
                required: false,
                extractFn: (content: string) => [],
            },
        ];

        const typeSpecificFields: Record<
            RequestMetadata["type"],
            Array<{
                field: string;
                description: string;
                required: boolean;
                extractFn: (content: string) => any;
            }>
        > = {
            social: [
                {
                    field: "platform",
                    description: "Target social media platform(s)",
                    required: true,
                    extractFn: this.extractPlatform.bind(this),
                },
                {
                    field: "hashtags",
                    description: "Relevant hashtags",
                    required: false,
                    extractFn: this.extractHashtags.bind(this),
                },
                {
                    field: "tone",
                    description: "Content tone/voice",
                    required: true,
                    extractFn: this.extractTone.bind(this),
                },
            ],
            merch: [
                {
                    field: "dimensions",
                    description: "Product dimensions or size range",
                    required: true,
                    extractFn: this.extractDimensions.bind(this),
                },
                {
                    field: "colors",
                    description: "Color specifications",
                    required: true,
                    extractFn: this.extractColors.bind(this),
                },
                {
                    field: "materials",
                    description: "Material requirements",
                    required: false,
                    extractFn: this.extractMaterials.bind(this),
                },
            ],
            logo: [
                {
                    field: "colors",
                    description: "Brand colors",
                    required: true,
                    extractFn: this.extractColors.bind(this),
                },
                {
                    field: "style",
                    description: "Logo style preferences",
                    required: true,
                    extractFn: this.extractStyle.bind(this),
                },
                {
                    field: "usage",
                    description: "Intended usage contexts",
                    required: true,
                    extractFn: this.extractUsage.bind(this),
                },
            ],
            website: [
                {
                    field: "pages",
                    description: "Affected pages or sections",
                    required: true,
                    extractFn: this.extractPages.bind(this),
                },
                {
                    field: "functionality",
                    description: "Functional requirements",
                    required: false,
                    extractFn: this.extractFunctionality.bind(this),
                },
                {
                    field: "technical",
                    description: "Technical specifications",
                    required: false,
                    extractFn: this.extractTechnical.bind(this),
                },
            ],
            creative_writing: [
                {
                    field: "wordCount",
                    description: "Target word count",
                    required: false,
                    extractFn: this.extractWordCount.bind(this),
                },
                {
                    field: "tone",
                    description: "Writing tone/style",
                    required: true,
                    extractFn: this.extractTone.bind(this),
                },
                {
                    field: "audience",
                    description: "Target audience",
                    required: true,
                    extractFn: this.extractAudience.bind(this),
                },
            ],
        };

        return [...commonFields, ...(typeSpecificFields[type] || [])];
    }

    private async extractBySchema(
        content: string,
        schema: Array<{
            field: string;
            description: string;
            required: boolean;
            extractFn: (content: string) => any;
        }>,
    ) {
        const result: Record<string, any> = {};

        for (const field of schema) {
            try {
                result[field.field] = await field.extractFn(content);
            } catch (error) {
                console.error(`Error extracting ${field.field}:`, error);
                if (field.required) {
                    throw error;
                }
            }
        }

        return result;
    }

    private filterRelevantFields(
        analysis: Record<string, any>,
        schema: Array<{ field: string }>,
    ) {
        const relevantFields: Record<string, any> = {};

        for (const field of schema) {
            if (analysis[field.field] !== undefined) {
                relevantFields[field.field] = analysis[field.field];
            }
        }

        return relevantFields;
    }

    // Additional extraction methods based on type-specific needs
    private extractPlatform(content: string): string[] {
        // TODO: Implement platform extraction
        return [];
    }

    private extractHashtags(content: string): string[] {
        // TODO: Implement hashtag extraction
        return [];
    }

    private extractColors(content: string): string[] {
        // TODO: Implement color extraction
        return [];
    }

    private extractMaterials(content: string): string[] {
        // TODO: Implement material extraction
        return [];
    }

    private extractStyle(content: string): string {
        // TODO: Implement style extraction
        return "";
    }

    private extractUsage(content: string): string[] {
        // TODO: Implement usage context extraction
        return [];
    }

    private extractPages(content: string): string[] {
        // TODO: Implement page extraction
        return [];
    }

    private extractFunctionality(content: string): string[] {
        // TODO: Implement functionality extraction
        return [];
    }

    private extractTechnical(content: string): Record<string, any> {
        // TODO: Implement technical spec extraction
        return {};
    }

    private extractWordCount(content: string): number | undefined {
        // TODO: Implement word count extraction
        return undefined;
    }

    // Helper methods for content extraction
    private extractRequirements(content: string): string[] {
        // TODO: Implement requirement extraction
        // Look for patterns like "must have", "needs to", "required", etc.
        return [];
    }

    private extractAudience(content: string): string | undefined {
        // TODO: Implement audience extraction
        // Look for patterns like "target audience", "for", "aimed at", etc.
        return undefined;
    }

    private extractTone(content: string): string | undefined {
        // TODO: Implement tone extraction
        // Look for tone indicators like "professional", "casual", "friendly", etc.
        return undefined;
    }

    private extractKeywords(content: string): string[] {
        // TODO: Implement keyword extraction
        // Look for hashtags, important terms, SEO keywords, etc.
        return [];
    }

    private extractReferences(content: string): string[] {
        // TODO: Implement reference extraction
        // Look for URLs, "like", "similar to", etc.
        return [];
    }

    private extractDimensions(
        content: string,
    ): { width?: number; height?: number; unit?: string } | undefined {
        // TODO: Implement dimension extraction
        // Look for patterns like "1920x1080", "500px", etc.
        return undefined;
    }

    private async enhanceStructuredContent(request: CreativeRequest) {
        // TODO: Implement AI-powered content enhancement
        return request.structured_content;
    }

    private async determineRequestType(
        structured: CreativeRequest["structured_content"],
    ): Promise<RequestMetadata["type"]> {
        // TODO: Implement AI-powered type determination
        return "social";
    }

    private async determinePriority(
        structured: CreativeRequest["structured_content"],
    ): Promise<RequestMetadata["priority"]> {
        // TODO: Implement priority determination logic
        return "medium";
    }

    // Add feedback for a request
    async addRequestFeedback(feedback: RequestFeedback): Promise<void> {
        if (!this.config.learningEnabled) return;

        try {
            // Store feedback in Supabase
            await this.supabase
                .from("request_feedback")
                .insert(feedback);

            // Update extraction patterns based on feedback
            await this.updateExtractionPatterns(feedback);

            // Update field frequency for this request type
            const request = await this.getRequestById(feedback.requestId);
            if (request) {
                this.updateFieldFrequency(request.metadata.type, feedback);
            }

            // Adapt schema if needed
            if (feedback.accuracy < this.config.adaptiveThreshold) {
                await this.adaptExtractionSchema(
                    request?.metadata.type,
                    feedback,
                );
            }
        } catch (error) {
            console.error("Error processing feedback:", error);
        }
    }

    private async loadLearnedPatterns(): Promise<void> {
        try {
            // Load previously learned patterns from Supabase
            const { data: patterns, error } = await this.supabase
                .from("learned_patterns")
                .select("*");

            if (error) throw error;

            // Initialize patterns
            patterns?.forEach((pattern) => {
                this.extractionPatterns.set(
                    pattern.field,
                    pattern.patterns.map((p: string) => new RegExp(p, "i")),
                );
            });

            // Load field frequency data
            const { data: frequency, error: freqError } = await this.supabase
                .from("field_frequency")
                .select("*");

            if (freqError) throw freqError;

            // Initialize frequency maps
            frequency?.forEach((freq) => {
                if (!this.fieldFrequency.has(freq.type)) {
                    this.fieldFrequency.set(freq.type, new Map());
                }
                this.fieldFrequency.get(freq.type)?.set(freq.field, freq.count);
            });
        } catch (error) {
            console.error("Error loading learned patterns:", error);
        }
    }

    private async updateExtractionPatterns(
        feedback: RequestFeedback,
    ): Promise<void> {
        const request = await this.getRequestById(feedback.requestId);
        if (!request) return;

        // Update patterns based on user corrections
        for (const [field, value] of Object.entries(feedback.userCorrections)) {
            const pattern = this.generatePattern(request.raw_content, value);
            if (pattern) {
                const patterns = this.extractionPatterns.get(field) || [];
                patterns.push(pattern);
                this.extractionPatterns.set(field, patterns);

                // Store new pattern in Supabase
                await this.supabase
                    .from("learned_patterns")
                    .upsert({
                        field,
                        pattern: pattern.source,
                        confidence: feedback.accuracy,
                        created_at: new Date().toISOString(),
                    });
            }
        }
    }

    private async updateFieldFrequency(
        type: RequestMetadata["type"],
        feedback: RequestFeedback,
    ): Promise<void> {
        const typeFrequency = this.fieldFrequency.get(type) || new Map();

        // Update frequency for correct fields
        const allFields = new Set([
            ...Object.keys(feedback.userCorrections),
            ...feedback.missingFields,
            ...feedback.incorrectFields,
            ...feedback.suggestedFields,
        ]);

        allFields.forEach((field) => {
            const count = typeFrequency.get(field) || 0;
            typeFrequency.set(field, count + 1);
        });

        this.fieldFrequency.set(type, typeFrequency);

        // Update frequency in Supabase
        await this.supabase
            .from("field_frequency")
            .upsert(
                Array.from(typeFrequency.entries()).map(([field, count]) => ({
                    type,
                    field,
                    count,
                    updated_at: new Date().toISOString(),
                })),
            );
    }

    private async adaptExtractionSchema(
        type: RequestMetadata["type"] | undefined,
        feedback: RequestFeedback,
    ): Promise<void> {
        if (!type) return;

        const typeFrequency = this.fieldFrequency.get(type);
        if (!typeFrequency) return;

        // Analyze frequently occurring fields
        const frequentFields = Array.from(typeFrequency.entries())
            .filter(([_, count]) => count > 5) // Threshold for considering a field frequent
            .map(([field]) => field);

        // Add suggested fields to schema if they appear frequently
        feedback.suggestedFields.forEach((field) => {
            if (frequentFields.includes(field)) {
                // Update type-specific schema
                const schema = this.getExtractionSchemaForType(type);
                const existingField = schema.find((f) => f.field === field);

                if (!existingField) {
                    // Add new field to schema
                    // Note: This would require modifying the type system
                    console.log(
                        `Consider adding field "${field}" to ${type} schema`,
                    );
                }
            }
        });
    }

    private generatePattern(content: string, value: any): RegExp | null {
        try {
            // Simple pattern generation for now
            // This could be enhanced with more sophisticated pattern learning
            const escaped = String(value).replace(
                /[.*+?^${}()|[\]\\]/g,
                (p: string) => `\\${p}`,
            );
            return new RegExp(`\\b${escaped}\\b`, "i");
        } catch (error) {
            console.error("Error generating pattern:", error);
            return null;
        }
    }

    private async getRequestById(id: string): Promise<CreativeRequest | null> {
        const { data, error } = await this.supabase
            .from("creative_requests")
            .select()
            .eq("id", id)
            .single();

        if (error) {
            console.error("Error fetching request:", error);
            return null;
        }

        return data;
    }
}

// Export plugin
export default function init(config?: Partial<PluginConfig>) {
    const defaultConfig: PluginConfig = {
        batchProcessingEnabled: true,
        batchInterval: 24 * 60 * 60 * 1000,
        autoSync: true,
        maxRetries: 3,
        aiProcessingEnabled: true,
        learningEnabled: true,
        adaptiveThreshold: 0.7,
    };

    return new CreativeRequestPlugin({
        ...defaultConfig,
        ...config,
    });
}
