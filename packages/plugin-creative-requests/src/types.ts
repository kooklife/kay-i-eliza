export interface StructuredContent {
    brief: string;
    requirements: string[];
    notes: string[];
    keywords: string[];
}

export interface RequestMetadata {
    type: "creative" | "revision" | "feedback";
    status: "new" | "in_progress" | "review" | "complete" | "cancelled";
    priority: "low" | "normal" | "high" | "urgent";
    source: string;
    assignee?: string;
    campaign?: string;
}

export interface CreativeRequest {
    id: string;
    raw_content: string;
    structured_content: StructuredContent;
    metadata: RequestMetadata;
    created_at: string;
    updated_at: string;
}

export interface ProcessingResult {
    success: boolean;
    request?: CreativeRequest;
    error?: string;
    warnings?: string[];
}
