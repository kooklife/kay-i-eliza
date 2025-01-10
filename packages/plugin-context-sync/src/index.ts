import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

declare global {
    var cursor: {
        registerCommand: (
            command: string,
            handler: () => Promise<string>,
        ) => void;
    };
    interface Window {
        cursor: {
            registerCommand: (
                command: string,
                handler: () => Promise<string>,
            ) => void;
        };
    }
}

interface ContextSyncOptions {
    autoSync?: boolean;
    syncInterval?: number;
    supabaseUrl: string;
    supabaseKey: string;
}

interface Tag {
    name: string;
    value: string;
    timestamp: number;
}

interface FileState {
    path: string;
    content: string;
    timestamp: number;
}

interface EnhancedMetadata {
    type: "cursor" | "composer" | "claude" | "kay-i";
    source: string;
    timestamp: number;
    tags: Tag[];
    files?: FileState[];
    workingState?: boolean;
    projectContext?: string;
    relatedConversations?: string[]; // IDs of related conversations
}

interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    metadata?: {
        fileContext?: string[];
        codeContext?: string;
        intent?: string;
    };
}

interface EnhancedConversation {
    id: string;
    title: string;
    messages: ChatMessage[];
    metadata: EnhancedMetadata;
    embedding?: number[]; // Vector embedding for semantic search
    created_at: number;
    updated_at: number;
}

interface WorkingState {
    timestamp: string;
    description: string;
    files: {
        [filePath: string]: {
            code: string;
            dependencies?: {
                imports: string[];
                relatedFiles: string[];
            };
        };
    };
}

interface ConversationMetadata {
    type: "cursor" | "composer";
    timestamp?: string;
    workingState?: WorkingState;
}

interface CursorChatData {
    tabId: string;
    chatTitle: string;
    lastSendTime: number;
    bubbles: ChatBubble[];
}

interface ChatBubble {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

// Add SQLite reading functionality
async function readCursorDatabase(dbPath: string) {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    try {
        // Read chat history
        const chatRows = await db.all(`
            SELECT * FROM chat_history
            ORDER BY updated_at DESC
        `);

        const chatData = {
            tabs: chatRows.map((row) => ({
                tabId: row.id,
                chatTitle: row.title,
                lastSendTime: row.updated_at,
                bubbles: JSON.parse(row.messages),
            })),
        };

        // Read composer history
        const composerRows = await db.all(`
            SELECT * FROM composer_history
            ORDER BY updated_at DESC
        `);

        const composerData = {
            allComposers: composerRows.map((row) => ({
                composerId: row.id,
                name: row.name,
                text: row.text,
                lastUpdatedAt: row.updated_at,
            })),
        };

        await db.close();
        return { chatData, composerData };
    } catch (error) {
        await db.close();
        throw error;
    }
}

async function initializeCursorDatabase(dbPath: string) {
    console.log("[ContextSyncPlugin] Initializing database at:", dbPath);
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    console.log("[ContextSyncPlugin] Creating tables if they don't exist...");
    // Create tables if they don't exist
    await db.run(`
        CREATE TABLE IF NOT EXISTS ItemTable (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id TEXT PRIMARY KEY,
            title TEXT,
            messages TEXT,
            created_at INTEGER,
            updated_at INTEGER
        );
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS composer_history (
            id TEXT PRIMARY KEY,
            name TEXT,
            text TEXT,
            created_at INTEGER,
            updated_at INTEGER
        );
    `);

    console.log("[ContextSyncPlugin] Tables created successfully");
    return db;
}

const COMMANDS = {
    SAVE_STATE: "context-sync.saveState",
    GET_CONTEXT: "/get-context",
    TAG_CONVERSATION: "context-sync.tagConversation",
    SEARCH: "context-sync.search",
};

export class ContextSyncPlugin {
    private syncInterval: NodeJS.Timeout | null = null;
    private defaultOptions = {
        autoSync: true,
        syncInterval: 5 * 60 * 1000, // 5 minutes
    };
    private options: ContextSyncOptions;
    private supabase!: SupabaseClient;
    private supabaseInitialized = false;
    private dbPath: string;

    constructor(options: ContextSyncOptions) {
        console.log(
            "[ContextSyncPlugin] Initializing plugin with options:",
            options,
        );
        this.options = { ...this.defaultOptions, ...options };

        if (!options.supabaseUrl || !options.supabaseKey) {
            throw new Error("supabaseUrl and supabaseKey are required");
        }

        if (this.options.autoSync) {
            console.log("[ContextSyncPlugin] Starting auto-sync...");
            this.startAutoSync();
        }

        // Get the Cursor workspace storage path
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (!homeDir) {
            throw new Error("Could not determine home directory");
        }

        this.dbPath = path.join(
            homeDir,
            "Library",
            "Application Support",
            "Cursor",
            "User",
            "workspaceStorage",
            "*",
            "state.vscdb",
        );

        // Initialize database
        this.initializeDatabase();

        // Register commands
        this.registerCommands();
    }

    // Start auto-sync
    private startAutoSync() {
        this.syncInterval = setInterval(async () => {
            // Get Cursor's database path based on OS
            const cursorDbPath = process.platform === "darwin"
                ? path.join(
                    process.env.HOME!,
                    "Library/Application Support/Cursor/User/workspaceStorage/state.vscdb",
                )
                : process.platform === "win32"
                ? path.join(
                    process.env.APPDATA!,
                    "Cursor/User/workspaceStorage/state.vscdb",
                )
                : path.join(
                    process.env.HOME!,
                    ".config/Cursor/User/workspaceStorage/state.vscdb",
                );

            await this.syncCursorToSupabase(cursorDbPath);
        }, this.options.syncInterval);
    }

    // Stop auto-sync
    public stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    // Store conversation
    async storeConversation(
        summary: string,
        fullContext: string,
        metadata: ConversationMetadata,
    ) {
        try {
            this.initSupabase();
            const { data, error } = await this.supabase
                .from("cursor_conversations")
                .insert({
                    summary,
                    full_context: fullContext,
                    metadata: {
                        ...metadata,
                        timestamp: new Date().toISOString(),
                    },
                });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error("Error storing conversation:", error);
            return null;
        }
    }

    // Get recent conversations
    async getRecentConversations(limit = 5) {
        try {
            this.initSupabase();
            const { data, error } = await this.supabase
                .from("enhanced_conversations")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error("Error getting recent conversations:", error);
            return null;
        }
    }

    // Add automatic sync from Cursor's SQLite to Supabase
    async syncCursorToSupabase(cursorDbPath: string) {
        try {
            this.initSupabase();

            // Initialize database if needed
            const db = await initializeCursorDatabase(cursorDbPath);

            const { chatData, composerData } = await readCursorDatabase(
                cursorDbPath,
            );

            if (chatData) {
                for (const tab of chatData.tabs) {
                    await this.storeConversation(
                        tab.chatTitle?.split("\n")[0] ||
                            `Chat ${tab.tabId.slice(0, 8)}`,
                        JSON.stringify(tab.bubbles),
                        {
                            type: "cursor",
                            timestamp: new Date(tab.lastSendTime).toISOString(),
                        },
                    );
                }
            }

            if (composerData) {
                for (const composer of composerData.allComposers) {
                    await this.storeConversation(
                        composer.name ||
                            `Composer ${composer.composerId.slice(0, 8)}`,
                        composer.text,
                        {
                            type: "composer",
                            timestamp: new Date(composer.lastUpdatedAt)
                                .toISOString(),
                        },
                    );
                }
            }

            return true;
        } catch (error) {
            console.error("Error syncing cursor history:", error);
            return false;
        }
    }

    // Enhanced conversation methods
    async storeEnhancedConversation(conversation: EnhancedConversation) {
        try {
            this.initSupabase();

            // First, check if the conversation exists
            const { data: existing, error: fetchError } = await this.supabase
                .from("enhanced_conversations")
                .select("*")
                .eq("id", conversation.id)
                .single();

            if (fetchError && fetchError.code !== "PGRST116") { // PGRST116 is "not found"
                throw fetchError;
            }

            if (existing) {
                // Merge metadata
                const mergedMetadata = {
                    ...existing.metadata,
                    ...conversation.metadata,
                    tags: [
                        ...(existing.metadata.tags || []),
                        ...(conversation.metadata.tags || []),
                    ],
                    relatedConversations: [
                        ...(existing.metadata.relatedConversations || []),
                        ...(conversation.metadata.relatedConversations || []),
                    ],
                };

                // Update existing record
                const { data, error } = await this.supabase
                    .from("enhanced_conversations")
                    .update({
                        title: conversation.title,
                        messages: conversation.messages,
                        metadata: mergedMetadata,
                        embedding: conversation.embedding || existing.embedding,
                        updated_at: Date.now(),
                    })
                    .eq("id", conversation.id);

                if (error) throw error;
                return data;
            } else {
                // Insert new record
                const { data, error } = await this.supabase
                    .from("enhanced_conversations")
                    .insert({
                        id: conversation.id,
                        title: conversation.title,
                        messages: conversation.messages,
                        metadata: conversation.metadata,
                        embedding: conversation.embedding,
                        created_at: conversation.created_at,
                        updated_at: conversation.updated_at,
                    });

                if (error) throw error;
                return data;
            }
        } catch (error) {
            console.error("Error storing enhanced conversation:", error);
            return null;
        }
    }

    async searchConversations(query: string, options: {
        type?: "cursor" | "composer" | "claude" | "kay-i";
        limit?: number;
        workingStatesOnly?: boolean;
        startDate?: number;
        endDate?: number;
    } = {}) {
        try {
            this.initSupabase();
            let queryBuilder = this.supabase
                .from("enhanced_conversations")
                .select("*");

            if (options.type) {
                queryBuilder = queryBuilder.eq("metadata->>type", options.type);
            }

            if (options.workingStatesOnly) {
                queryBuilder = queryBuilder.eq("metadata->>workingState", true);
            }

            if (options.startDate) {
                queryBuilder = queryBuilder.gte(
                    "created_at",
                    options.startDate,
                );
            }

            if (options.endDate) {
                queryBuilder = queryBuilder.lte("created_at", options.endDate);
            }

            // Format search query for tsquery
            if (query) {
                const formattedQuery = query
                    .trim()
                    .split(/\s+/)
                    .map((term) => term + ":*")
                    .join(" & ");

                queryBuilder = queryBuilder.textSearch(
                    "title",
                    formattedQuery,
                    {
                        config: "english",
                        type: "websearch",
                    },
                );
            }

            const { data, error } = await queryBuilder
                .limit(options.limit || 10)
                .order("created_at", { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error("Error searching conversations:", error);
            return null;
        }
    }

    async getContextForNewChat() {
        try {
            this.initSupabase();
            // Get most recent working state
            const workingState = await this.searchConversations("", {
                workingStatesOnly: true,
                limit: 1,
            });

            // Get recent relevant conversations
            const recentConversations = await this.getRecentConversations(3);

            return {
                workingState: workingState?.[0],
                recentContext: recentConversations,
                projectContext: await this.getProjectContext(),
            };
        } catch (error) {
            console.error("Error getting context for new chat:", error);
            return null;
        }
    }

    async tagConversation(conversationId: string, tag: Tag) {
        try {
            this.initSupabase();
            const { data: existing, error: fetchError } = await this.supabase
                .from("enhanced_conversations")
                .select("metadata")
                .eq("id", conversationId)
                .single();

            if (fetchError) throw fetchError;

            const metadata = existing.metadata as EnhancedMetadata;
            metadata.tags = [...(metadata.tags || []), tag];

            const { error: updateError } = await this.supabase
                .from("enhanced_conversations")
                .update({ metadata })
                .eq("id", conversationId);

            if (updateError) throw updateError;
            return true;
        } catch (error) {
            console.error("Error tagging conversation:", error);
            return false;
        }
    }

    private async getProjectContext() {
        try {
            this.initSupabase();
            const { data, error } = await this.supabase
                .from("project_context")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(1);

            if (error) throw error;
            return data?.[0];
        } catch (error) {
            console.error("Error getting project context:", error);
            return null;
        }
    }

    // Enhanced sync method
    async syncCursorToSupabaseEnhanced(cursorDbPath: string) {
        try {
            this.initSupabase();
            const { chatData, composerData } = await readCursorDatabase(
                cursorDbPath,
            );

            if (chatData) {
                for (const tab of chatData.tabs) {
                    const { data, error } = await this.supabase
                        .from("enhanced_conversations")
                        .upsert({
                            id: tab.tabId,
                            title: tab.chatTitle?.split("\n")[0] ||
                                `Chat ${tab.tabId.slice(0, 8)}`,
                            messages: tab.bubbles.map((bubble: ChatBubble) => ({
                                role: bubble.role,
                                content: bubble.content,
                                timestamp: bubble.timestamp,
                            })),
                            metadata: {
                                type: "cursor",
                                source: "cursor-chat",
                                timestamp: tab.lastSendTime,
                                tags: [],
                                workingState: false,
                            },
                            created_at: tab.lastSendTime,
                            updated_at: Date.now(),
                        }, {
                            onConflict: "id",
                            ignoreDuplicates: false,
                        });

                    if (error) {
                        console.error(
                            "Error storing enhanced conversation:",
                            error,
                        );
                    }
                }
            }

            if (composerData) {
                for (const composer of composerData.allComposers) {
                    const { data, error } = await this.supabase
                        .from("enhanced_conversations")
                        .upsert({
                            id: composer.composerId,
                            title: composer.name ||
                                `Composer ${composer.composerId.slice(0, 8)}`,
                            messages: [{
                                role: "user",
                                content: composer.text,
                                timestamp: composer.lastUpdatedAt,
                            }],
                            metadata: {
                                type: "composer",
                                source: "cursor-composer",
                                timestamp: composer.lastUpdatedAt,
                                tags: [],
                                workingState: false,
                            },
                            created_at: composer.lastUpdatedAt,
                            updated_at: Date.now(),
                        }, {
                            onConflict: "id",
                            ignoreDuplicates: false,
                        });

                    if (error) {
                        console.error(
                            "Error storing enhanced conversation:",
                            error,
                        );
                    }
                }
            }

            return true;
        } catch (error) {
            console.error("Error syncing enhanced cursor history:", error);
            return false;
        }
    }

    async storeChatHistory(chat: {
        id: string;
        title: string;
        messages: ChatBubble[];
    }) {
        const cursorDbPath = process.platform === "darwin"
            ? path.join(
                process.env.HOME!,
                "Library/Application Support/Cursor/User/workspaceStorage/state.vscdb",
            )
            : process.platform === "win32"
            ? path.join(
                process.env.APPDATA!,
                "Cursor/User/workspaceStorage/state.vscdb",
            )
            : path.join(
                process.env.HOME!,
                ".config/Cursor/User/workspaceStorage/state.vscdb",
            );

        // Initialize database first
        const db = await initializeCursorDatabase(cursorDbPath);

        try {
            const now = Date.now();
            await db.run(
                `INSERT OR REPLACE INTO chat_history (id, title, messages, created_at, updated_at)
                 VALUES ('${chat.id}', '${chat.title}', '${
                    JSON.stringify(chat.messages).replace(/'/g, "''")
                }', ${now}, ${now})`,
            );

            // Also sync to Supabase
            await this.syncCursorToSupabaseEnhanced(cursorDbPath);
        } finally {
            await db.close();
        }
    }

    async storeComposerHistory(composer: {
        id: string;
        name: string;
        text: string;
    }) {
        console.log(
            "[ContextSyncPlugin] Storing composer history:",
            composer.id,
        );
        const cursorDbPath = process.platform === "darwin"
            ? path.join(
                process.env.HOME!,
                "Library/Application Support/Cursor/User/workspaceStorage/state.vscdb",
            )
            : process.platform === "win32"
            ? path.join(
                process.env.APPDATA!,
                "Cursor/User/workspaceStorage/state.vscdb",
            )
            : path.join(
                process.env.HOME!,
                ".config/Cursor/User/workspaceStorage/state.vscdb",
            );

        console.log("[ContextSyncPlugin] Using database path:", cursorDbPath);
        // Initialize database first
        const db = await initializeCursorDatabase(cursorDbPath);

        try {
            const now = Date.now();
            await db.run(
                `INSERT OR REPLACE INTO composer_history (id, name, text, created_at, updated_at)
                 VALUES ('${composer.id}', '${composer.name}', '${
                    composer.text.replace(/'/g, "''")
                }', ${now}, ${now})`,
            );
            console.log(
                "[ContextSyncPlugin] Successfully stored composer history",
            );

            // Also sync to Supabase
            await this.syncCursorToSupabaseEnhanced(cursorDbPath);
        } catch (error) {
            console.error(
                "[ContextSyncPlugin] Error storing composer history:",
                error,
            );
            throw error;
        } finally {
            await db.close();
        }
    }

    async formatContextForInjection() {
        console.log(
            "[ContextSyncPlugin] Starting formatContextForInjection...",
        );
        try {
            const context = await this.getContextForNewChat();
            console.log(
                "[ContextSyncPlugin] getContextForNewChat result:",
                context,
            );
            if (!context) {
                console.log(
                    "[ContextSyncPlugin] No context returned from getContextForNewChat",
                );
                return null;
            }

            let formattedContext = "📚 Previous Context:\n\n";

            // Add working state if exists
            if (context.workingState) {
                console.log(
                    "[ContextSyncPlugin] Adding working state:",
                    context.workingState.title,
                );
                formattedContext +=
                    `🔄 Current Working State:\n${context.workingState.title}\n`;
                if (context.workingState.metadata.files?.length) {
                    formattedContext += "\nRelevant Files:\n";
                    context.workingState.metadata.files.forEach(
                        (file: FileState) => {
                            formattedContext += `- ${file.path}\n`;
                        },
                    );
                }
                formattedContext += "\n";
            }

            // Add recent conversations
            if (context.recentContext?.length) {
                console.log(
                    "[ContextSyncPlugin] Adding recent conversations:",
                    context.recentContext.length,
                );
                formattedContext += "🗣️ Recent Conversations:\n";
                context.recentContext.forEach((conv) => {
                    formattedContext += `- ${conv.summary || conv.title}\n`;
                });
                formattedContext += "\n";
            }

            // Add project context if exists
            if (context.projectContext) {
                console.log(
                    "[ContextSyncPlugin] Adding project context:",
                    context.projectContext.title,
                );
                formattedContext += `📋 Project Context:\n${
                    context.projectContext.description ||
                    context.projectContext.title
                }\n\n`;
            }

            console.log(
                "[ContextSyncPlugin] Formatted context:",
                formattedContext,
            );
            return {
                formattedContext,
                rawContext: context,
            };
        } catch (error) {
            console.error(
                "[ContextSyncPlugin] Error in formatContextForInjection:",
                error,
            );
            throw error;
        }
    }

    async handleCommand(command: string, args: any) {
        console.log(
            "[ContextSyncPlugin] Handling command:",
            command,
            "with args:",
            args,
        );
        switch (command) {
            case COMMANDS.SAVE_STATE:
                return await this.saveCurrentState(
                    args.description,
                    args.files,
                );
            case COMMANDS.GET_CONTEXT:
                console.log(
                    "[ContextSyncPlugin] Handling GET_CONTEXT through handleCommand",
                );
                return await this.formatContextForInjection();
            case COMMANDS.TAG_CONVERSATION:
                return await this.tagConversation(
                    args.conversationId,
                    args.tag,
                );
            case COMMANDS.SEARCH:
                return await this.searchConversations(args.query, args.options);
            default:
                throw new Error(`Unknown command: ${command}`);
        }
    }

    async saveCurrentState(
        description: string,
        files?: { [path: string]: string },
    ) {
        const now = Date.now();
        const stateId = `state-${now}`;

        const conversation: EnhancedConversation = {
            id: stateId,
            title: `Working State: ${description}`,
            messages: [{
                role: "system",
                content: description,
                timestamp: now,
            }],
            metadata: {
                type: "cursor",
                source: "working-state",
                timestamp: now,
                tags: [{
                    name: "type",
                    value: "working-state",
                    timestamp: now,
                }],
                workingState: true,
                files: files
                    ? Object.entries(files).map(([path, content]) => ({
                        path,
                        content,
                        timestamp: now,
                    }))
                    : [],
            },
            created_at: now,
            updated_at: now,
        };

        await this.storeEnhancedConversation(conversation);
        return stateId;
    }

    private registerCommands() {
        console.log("[ContextSyncPlugin] Registering commands...");

        // Try to get cursor from either global or window
        const cursor = (typeof global !== "undefined" && global.cursor) ||
            (typeof window !== "undefined" && (window as any).cursor);

        if (cursor) {
            console.log(
                "[ContextSyncPlugin] Registering with Cursor's command system",
            );
            try {
                // Log all registered commands before adding ours
                console.log("[ContextSyncPlugin] Current cursor:", {
                    hasRegisterCommand: !!cursor.registerCommand,
                    type: typeof cursor.registerCommand,
                });

                cursor.registerCommand(COMMANDS.GET_CONTEXT, async () => {
                    console.log(
                        "[ContextSyncPlugin] GET_CONTEXT command triggered",
                    );
                    try {
                        const result = await this.formatContextForInjection();
                        console.log(
                            "[ContextSyncPlugin] GET_CONTEXT result:",
                            result,
                        );
                        if (!result) {
                            return "Error: Could not retrieve context";
                        }
                        return result.formattedContext;
                    } catch (error) {
                        console.error(
                            "[ContextSyncPlugin] Error getting context:",
                            error,
                        );
                        return "Error retrieving context. Please check the logs.";
                    }
                });

                console.log(
                    "[ContextSyncPlugin] Successfully registered command:",
                    COMMANDS.GET_CONTEXT,
                );
            } catch (error: any) {
                console.error(
                    "[ContextSyncPlugin] Error registering command:",
                    error,
                );
                console.error("[ContextSyncPlugin] Error details:", {
                    name: error?.name,
                    message: error?.message,
                    stack: error?.stack,
                });
            }
        } else {
            console.error(
                "[ContextSyncPlugin] Cursor's command system not available",
            );
            console.error(
                "[ContextSyncPlugin] global object keys:",
                Object.keys(global),
            );
        }
    }

    private async getCurrentContext() {
        console.log("[ContextSyncPlugin] Getting current context");
        try {
            const { chatData, composerData } = await readCursorDatabase(
                this.dbPath,
            );
            return {
                chat: chatData,
                composer: composerData,
                workingState: true,
                timestamp: Date.now(),
            };
        } catch (error) {
            console.error(
                "[ContextSyncPlugin] Error in getCurrentContext:",
                error,
            );
            throw error;
        }
    }

    private async initializeDatabase() {
        console.log("[ContextSyncPlugin] Initializing database");
        try {
            await initializeCursorDatabase(this.dbPath);
        } catch (error) {
            console.error(
                "[ContextSyncPlugin] Error initializing database:",
                error,
            );
            throw error;
        }
    }

    private initSupabase() {
        if (!this.supabaseInitialized) {
            this.supabase = createClient(
                this.options.supabaseUrl,
                this.options.supabaseKey,
            );
            this.supabaseInitialized = true;
        }
    }
}

// Export plugin
export { COMMANDS };
export default function init(options: ContextSyncOptions) {
    // Initialize plugin in browser environment
    if (typeof window !== "undefined") {
        console.log("[ContextSyncPlugin] Initializing in browser environment");
        const plugin = new ContextSyncPlugin(options);

        // Register commands with window.cursor
        if (window.cursor) {
            console.log(
                "[ContextSyncPlugin] Registering commands with window.cursor",
            );
            window.cursor.registerCommand(COMMANDS.GET_CONTEXT, async () => {
                console.log(
                    "[ContextSyncPlugin] GET_CONTEXT command triggered in browser",
                );
                try {
                    const result = await plugin.formatContextForInjection();
                    console.log(
                        "[ContextSyncPlugin] GET_CONTEXT result:",
                        result,
                    );
                    if (!result) {
                        return "Error: Could not retrieve context";
                    }
                    return result.formattedContext;
                } catch (error) {
                    console.error(
                        "[ContextSyncPlugin] Error getting context:",
                        error,
                    );
                    return "Error retrieving context. Please check the logs.";
                }
            });
        }
        return plugin;
    }

    // Initialize plugin in Node.js environment
    return new ContextSyncPlugin(options);
}
