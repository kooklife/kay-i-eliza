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
        // Test 1: Store a chat conversation
        console.log("Test 1: Storing chat conversation...");
        const chatResult = await plugin.storeChatHistory({
            id: `test-chat-${Date.now()}`,
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
        });
        console.log("Chat stored successfully");

        // Test 2: Store a composer conversation
        console.log("\nTest 2: Storing composer conversation...");
        const composerResult = await plugin.storeComposerHistory({
            id: `test-composer-${Date.now()}`,
            name: "Test Composer",
            text:
                "// This is a test composer message\nfunction testFunction() {\n  console.log('hello');\n}",
        });
        console.log("Composer stored successfully");

        // Test 3: Search conversations
        console.log("\nTest 3: Searching conversations...");
        console.log("Searching for recently stored conversations...");
        const searchResults = await plugin.searchConversations("test", {
            limit: 5,
        });
        console.log(`Found ${searchResults?.length || 0} conversations`);
        if (searchResults?.length) {
            console.log("Latest conversation:", {
                title: searchResults[0].title,
                type: searchResults[0].metadata.type,
                created_at: new Date(searchResults[0].created_at).toISOString(),
            });
        } else {
            console.log(
                "No conversations found, trying without search query...",
            );
            const allResults = await plugin.searchConversations("", {
                limit: 5,
            });
            console.log(`Found ${allResults?.length || 0} total conversations`);
            if (allResults?.length) {
                console.log(
                    "Available conversations:",
                    allResults.map((conv) => ({
                        title: conv.title,
                        type: conv.metadata.type,
                        created_at: new Date(conv.created_at).toISOString(),
                    })),
                );
            }
        }

        // Test 4: Get context for new chat
        console.log("\nTest 4: Getting context for new chat...");
        const context = await plugin.getContextForNewChat();
        console.log("Context retrieved:", {
            hasWorkingState: !!context?.workingState,
            recentContextCount: context?.recentContext?.length || 0,
            hasProjectContext: !!context?.projectContext,
        });

        // Test 5: Tag a conversation
        console.log("\nTest 5: Tagging conversation...");
        if (searchResults?.length) {
            const tagResult = await plugin.tagConversation(
                searchResults[0].id,
                {
                    name: "status",
                    value: "completed",
                    timestamp: Date.now(),
                },
            );
            console.log("Tag added:", tagResult);
        }

        // Test 6: Verify auto-sync
        console.log("\nTest 6: Testing auto-sync...");
        plugin.stopAutoSync(); // Stop any existing sync
        let syncCount = 0;
        const testAutoSync = new ContextSyncPlugin({
            autoSync: true,
            syncInterval: 2000, // 2 seconds for testing
            supabaseUrl: SUPABASE_URL,
            supabaseKey: SUPABASE_KEY,
        });

        // Wait for two sync cycles
        await new Promise((resolve) => setTimeout(resolve, 4500));
        testAutoSync.stopAutoSync();
        console.log("Auto-sync tested successfully");

        console.log("\n=== All tests completed successfully ===\n");
    } catch (error) {
        console.error("\nTest failed:", error);
        process.exit(1);
    }
}

runTests().catch((error) => {
    console.error("Test suite failed:", error);
    process.exit(1);
});
