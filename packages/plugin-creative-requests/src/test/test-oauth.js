import { AirtableService } from "../services/airtable.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.resolve(__dirname, "../../.env");
const CODE_VERIFIER_FILE = path.resolve(__dirname, "../../.code-verifier");

dotenv.config({ path: ENV_FILE });

async function main() {
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

    // For testing, if we have a code, try to exchange it
    const authCode = process.env.AIRTABLE_AUTH_CODE;
    if (authCode) {
        try {
            // Read the code verifier from file
            if (!fs.existsSync(CODE_VERIFIER_FILE)) {
                throw new Error(
                    "No code verifier found. Please start the OAuth flow again.",
                );
            }
            const codeVerifier = fs.readFileSync(CODE_VERIFIER_FILE, "utf8");
            console.log("\nUsing saved code verifier:", codeVerifier);

            // Set the code verifier from our successful authorization
            const authService = airtable.getAuthService();
            authService.codeVerifier = codeVerifier;

            console.log("\nExchanging authorization code for token...");
            const token = await authService.exchangeCodeForToken(authCode);
            console.log("\n=== Access Token ===");
            console.log(token);
            console.log("==================\n");

            // Store the token in .env file
            const envContent = fs.readFileSync(ENV_FILE, "utf8");
            const updatedContent = envContent.replace(
                /^AIRTABLE_AUTH_CODE=.*/m,
                `AIRTABLE_AUTH_CODE=${authCode}\nAIRTABLE_ACCESS_TOKEN=${token}`,
            );
            fs.writeFileSync(ENV_FILE, updatedContent);
            console.log("Stored access token in .env file");

            // Clean up code verifier
            fs.unlinkSync(CODE_VERIFIER_FILE);

            // Set the token for subsequent requests
            airtable.setAccessToken(token);

            // Try to create a test request
            console.log("\nTesting request creation...");
            const testRequest = {
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
    } else {
        // Generate a random state value
        const state = crypto.randomBytes(16).toString("hex");
        console.log("\nGenerated state value (save this):", state);

        // Get the authorization URL with state parameter
        const authService = airtable.getAuthService();
        const authUrl = await authService.getAuthorizationUrl(state);

        // Save the code verifier for later
        fs.writeFileSync(CODE_VERIFIER_FILE, authService.codeVerifier);
        console.log("\nSaved code verifier for token exchange");

        console.log("\nAuthorization URL (open this in a browser):");
        console.log(authUrl);

        console.log(
            "\nAfter authorization, you'll receive a code at the redirect URI",
        );
        console.log("Set that code in your .env file as AIRTABLE_AUTH_CODE");
    }
}

main().catch(console.error);
