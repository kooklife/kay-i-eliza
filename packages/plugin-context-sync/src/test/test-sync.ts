import { ContextSyncPlugin } from "../index";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from root directory
dotenv.config({ path: path.join(__dirname, "../../../../.env") });

// Debug environment loading
console.log("Current directory:", __dirname);
console.log("Env file path:", path.join(__dirname, "../../../../.env"));
console.log("Environment variables loaded:", {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
        ? "exists"
        : "missing",
    NODE_ENV: process.env.NODE_ENV,
});

// Verify environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        "Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
}

const SUPABASE_URL: string = supabaseUrl;
const SUPABASE_KEY: string = supabaseKey;

console.log("Environment check:", {
    supabaseUrl: SUPABASE_URL,
    hasSupabaseKey: true,
});

async function runTests() {
    console.log("\n=== Starting Context Sync Plugin Tests ===\n");

    // Initialize plugin
    const plugin = new ContextSyncPlugin({
        autoSync: false,
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_KEY,
    });

    try {
        // Test 1: Store a chat conversation directly to Supabase
        console.log("Test 1: Storing chat conversation to Supabase...");
        const chatId = `test-chat-${Date.now()}`;
        const result = await plugin.storeEnhancedConversation({
            id: chatId,
            title: "Test Chat",
            messages: [
                {
                    role: "user",
                    content: "How do I implement a context sync plugin?",
                    timestamp: Date.now(),
                },
                {
                    role: "assistant",
                    content:
                        "I'll help you implement a context sync plugin. First, let's...",
                    timestamp: Date.now() + 1000,
                },
            ],
            metadata: {
                type: "cursor",
                source: "test",
                timestamp: Date.now(),
                tags: [],
                workingState: false,
            },
            created_at: Date.now(),
            updated_at: Date.now(),
        });
        console.log("Chat stored successfully in Supabase");

        // Test 2: Store a composer conversation
        console.log("\nTest 2: Storing composer conversation to Supabase...");
        const composerId = `test-composer-${Date.now()}`;
        await plugin.storeEnhancedConversation({
            id: composerId,
            title: "Test Composer",
            messages: [{
                role: "user",
                content:
                    "// This is a test composer message\nfunction testFunction() {\n  console.log('hello');\n}",
                timestamp: Date.now(),
            }],
            metadata: {
                type: "composer",
                source: "test",
                timestamp: Date.now(),
                tags: [],
                workingState: false,
            },
            created_at: Date.now(),
            updated_at: Date.now(),
        });
        console.log("Composer stored successfully in Supabase");

        // Test 3: Search conversations
        console.log("\nTest 3: Searching conversations in Supabase...");
        const searchResults = await plugin.searchConversations("test", {
            limit: 5,
        });
        console.log(
            `Found ${searchResults?.length || 0} conversations in Supabase`,
        );
        if (searchResults?.length) {
            console.log("Latest conversation:", {
                title: searchResults[0].title,
                type: searchResults[0].metadata.type,
                created_at: new Date(searchResults[0].created_at).toISOString(),
            });
        }

        // Test 4: Get context for new chat
        console.log("\nTest 4: Getting context from Supabase...");
        const context = await plugin.getContextForNewChat();
        console.log("Context retrieved from Supabase:", {
            hasWorkingState: !!context?.workingState,
            recentContextCount: context?.recentContext?.length || 0,
            hasProjectContext: !!context?.projectContext,
        });

        // Test 5: Tag a conversation
        console.log("\nTest 5: Tagging conversation in Supabase...");
        if (searchResults?.length) {
            const tagResult = await plugin.tagConversation(
                searchResults[0].id,
                {
                    name: "status",
                    value: "completed",
                    timestamp: Date.now(),
                },
            );
            console.log("Tag added to Supabase:", tagResult);
        }

        console.log(
            "\n=== All Supabase sync tests completed successfully ===\n",
        );
    } catch (error) {
        console.error("\nTest failed:", error);
        process.exit(1);
    }
}

runTests().catch((error) => {
    console.error("Test suite failed:", error);
    process.exit(1);
});
