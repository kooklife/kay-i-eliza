import { AirtableService } from "../services/airtable.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { CreativeRequest } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function testAirtableOAuth() {
    console.log("Testing Airtable OAuth integration...");

    // Log environment variables to verify they're being read correctly
    console.log("Environment variables:");
    console.log("- Client ID:", process.env.AIRTABLE_CLIENT_ID);
    console.log("- Redirect URI:", process.env.AIRTABLE_REDIRECT_URI);

    const airtable = new AirtableService(
        process.env.AIRTABLE_CLIENT_ID || "",
        process.env.AIRTABLE_CLIENT_SECRET || "",
        process.env.AIRTABLE_REDIRECT_URI || "",
        process.env.AIRTABLE_BASE_ID || "",
        "Deliverables",
    );

    // Get the authorization URL
    const authUrl = airtable.getAuthService().getAuthorizationUrl();
    console.log("\nAuthorization URL (open this in a browser):");
    console.log(authUrl);

    // In a real application, you would:
    // 1. Redirect the user to authUrl
    // 2. Handle the callback at AIRTABLE_REDIRECT_URI
    // 3. Exchange the code for a token
    // 4. Store the token securely

    console.log(
        "\nAfter authorization, you'll receive a code at the redirect URI",
    );
    console.log("Set that code in your .env file as AIRTABLE_AUTH_CODE");

    // For testing, if we have a code, try to exchange it
    const authCode = process.env.AIRTABLE_AUTH_CODE;
    if (authCode) {
        try {
            console.log("\nExchanging authorization code for token...");
            const token = await airtable.getAuthService().exchangeCodeForToken(
                authCode,
            );
            console.log("Successfully obtained access token");

            // Set the token for subsequent requests
            airtable.setAccessToken(token);

            // Try to create a test request
            console.log("\nTesting request creation...");
            const testRequest: CreativeRequest = {
                id: `test-${Date.now()}`,
                raw_content: "Create a modern logo for our tech startup",
                structured_content: {
                    brief: "Modern tech startup logo design",
                    requirements: ["Clean and minimal", "Tech-focused"],
                    notes: ["Reference successful tech logos"],
                    keywords: ["modern", "tech", "minimal"],
                },
                metadata: {
                    type: "creative",
                    status: "new",
                    priority: "normal",
                    source: "test",
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            const recordId = await airtable.createRequest(testRequest);
            console.log("Created request with record ID:", recordId);

            // Test retrieving the request
            console.log("\nTesting request retrieval...");
            const retrieved = await airtable.getRequest(recordId);
            console.log("Retrieved request:", retrieved);

            // Clean up
            console.log("\nCleaning up - deleting test request...");
            await airtable.deleteRequest(recordId);
            console.log("Deleted test request");
        } catch (error) {
            console.error("Error during OAuth flow:", error);
        }
    }
}

// Run the OAuth test
await testAirtableOAuth();
