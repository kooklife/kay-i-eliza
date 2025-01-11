import { ExtractionService } from "./services/extraction.js";
import dotenv from "dotenv";

dotenv.config();

async function runTests() {
    const extractionService = new ExtractionService(
        process.env.OPENAI_API_KEY || "",
        process.env.HUGGINGFACE_API_KEY || "",
    );

    // Test color extraction
    console.log("\nTesting color extraction:");
    const colorText =
        "I need a logo with deep navy blue and bright red accents, with some gold highlights";
    const colors = await extractionService.extractBasicColors(colorText);
    console.log("Basic colors:", colors);

    const hfColors = await extractionService.extractHFColors(colorText);
    console.log("HF colors:", hfColors);

    // Test dimension extraction
    console.log("\nTesting dimension extraction:");
    const dimensionText =
        "The banner should be 1920x1080 pixels and the logo should be 200x200";
    const dimensions = extractionService.extractNLPDimensions(dimensionText);
    console.log("Dimensions:", dimensions);

    // Test material extraction
    console.log("\nTesting material extraction:");
    const materialText =
        "We want a business card made of premium cardstock with a metallic finish and wood texture elements";
    const materials = await extractionService.extractHFMaterials(materialText);
    console.log("Materials:", materials);

    // Test topic extraction
    console.log("\nTesting topic extraction:");
    const topicText =
        "Create a modern, minimalist design for our technology startup focusing on sustainable innovation";
    const topics = await extractionService.extractHFTopics(topicText);
    console.log("Topics:", topics);

    // Test keyword extraction
    console.log("\nTesting keyword extraction:");
    const keywordText =
        "Design a professional branding package for our luxury real estate company that specializes in modern architecture";
    const keywords = await extractionService.extractKeywords(keywordText);
    console.log("Keywords:", keywords);
}

runTests().catch(console.error);
