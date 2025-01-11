import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("Checking current OAuth token scopes...");

    const token = process.env.AIRTABLE_ACCESS_TOKEN;
    if (!token) {
        throw new Error("No access token found in .env file");
    }

    try {
        const response = await axios.get(
            "https://api.airtable.com/v0/meta/whoami",
            {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );

        console.log("\nToken information:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error: any) {
        if (error.response) {
            console.error("Error response:", {
                status: error.response.status,
                data: error.response.data,
            });
        } else {
            console.error("Error checking token:", error.message);
        }
    }
}

main().catch(console.error);
