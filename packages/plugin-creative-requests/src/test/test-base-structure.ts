import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("Updating base structure...");

    const token = process.env.AIRTABLE_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!token || !baseId) {
        throw new Error("Missing required environment variables");
    }

    try {
        // First, get current tables to get the Requests table ID
        const tablesResponse = await axios.get(
            `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
            {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );

        const requestsTable = tablesResponse.data.tables.find((t: any) =>
            t.name === "Requests Master"
        );
        if (!requestsTable) {
            throw new Error("Requests Master table not found");
        }

        // Now add remaining fields one at a time
        const newFields = [
            {
                name: "Keywords",
                type: "multipleSelects",
                description: "Key terms and topics",
                options: {
                    choices: [], // Will be populated as keywords are added
                },
            },
            {
                name: "Topics",
                type: "multipleSelects",
                description: "Main topics covered",
                options: {
                    choices: [
                        { name: "Product", color: "blueLight2" },
                        { name: "Company", color: "greenLight2" },
                        { name: "Industry", color: "purpleLight2" },
                        { name: "Technology", color: "orangeLight2" },
                    ],
                },
            },
            {
                name: "Notes",
                type: "multilineText",
                description: "Additional context and requirements",
            },
        ];

        for (const field of newFields) {
            console.log(`\nAdding field: ${field.name}`);
            await axios.post(
                `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${requestsTable.id}/fields`,
                field,
                {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            console.log(`Successfully added field: ${field.name}`);
        }

        console.log("\nAll updates completed successfully!");
    } catch (error: any) {
        if (error.response) {
            console.error("Error response:", {
                status: error.response.status,
                data: error.response.data,
            });
        } else {
            console.error("Error:", error.message);
        }
    }
}

main().catch(console.error);
