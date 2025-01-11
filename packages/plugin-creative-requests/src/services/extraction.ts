import compromise from "compromise";
import natural from "natural";
import colorNamer from "color-namer";
import { OpenAI } from "openai";
import keywordExtractor from "keyword-extractor";
import * as tf from "@tensorflow/tfjs-node";
import { HfInference } from "@huggingface/inference";

export class ExtractionService {
    private nlp: typeof compromise;
    private tokenizer: natural.WordTokenizer;
    private tfidf: natural.TfIdf;
    private openai: OpenAI;
    private hf: HfInference;

    constructor(openaiApiKey: string, hfApiKey: string) {
        // Initialize NLP tools
        this.nlp = compromise;
        this.tokenizer = new natural.WordTokenizer();
        this.tfidf = new natural.TfIdf();

        // Initialize OpenAI
        this.openai = new OpenAI({
            apiKey: openaiApiKey,
            baseURL: "https://api.openai.com/v1",
            maxRetries: 3,
            timeout: 30000,
        });

        // Initialize Hugging Face
        this.hf = new HfInference(hfApiKey);
    }

    async analyzeContent(content: string): Promise<{
        type: string;
        platform?: string;
        colors: string[];
        dimensions: Array<{ value: number; unit: string }>;
        topics: string[];
        requirements: string[];
        keywords: string[];
        brief: string;
    }> {
        // Extract request type and platform
        const type = await this.determineRequestType(content);
        const platform = this.determinePlatform(content);

        // Run extractions in parallel
        const [colors, dimensions, topics, keywords, brief] = await Promise.all(
            [
                this.extractColors(content),
                this.extractDimensions(content),
                this.extractHFTopics(content),
                this.extractKeywords(content),
                this.generateStructuredBrief(content, type, platform),
            ],
        );

        // Extract requirements based on type and platform
        const requirements = await this.extractRequirements(
            content,
            type,
            platform,
        );

        return {
            type,
            platform,
            colors,
            dimensions,
            topics,
            requirements,
            keywords,
            brief,
        };
    }

    private async determineRequestType(content: string): Promise<string> {
        const typePatterns = {
            social:
                /\b(post|instagram|ig|linkedin|tiktok|facebook|twitter|x|social)\b/i,
            merch: /\b(merch|merchandise|shirt|hoodie|apparel|swag)\b/i,
            logo: /\b(logo|branding|brand|icon)\b/i,
            website: /\b(website|webpage|landing|page|site)\b/i,
            creative_writing: /\b(article|blog|copy|content|write|writing)\b/i,
        };

        for (const [type, pattern] of Object.entries(typePatterns)) {
            if (pattern.test(content)) {
                return type;
            }
        }

        // If no clear match, use OpenAI to determine type
        const response = await this.openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "user",
                content:
                    `Classify this creative request into one of these categories: social, merch, logo, website, creative_writing. Return only the category name.\n\nRequest: ${content}`,
            }],
            max_tokens: 10,
            temperature: 0,
        });

        return response.choices[0].message?.content?.toLowerCase() || "social";
    }

    private determinePlatform(content: string): string | undefined {
        const platformMatches = content.toLowerCase().match(
            /\b(instagram|ig|linkedin|tiktok|facebook|twitter|x)\b/g,
        );

        if (!platformMatches) return undefined;

        const platform = platformMatches[0];
        return platform === "ig" ? "instagram" : platform;
    }

    async extractColors(content: string): Promise<string[]> {
        // First pass: Use regex for basic colors
        const basicColors = this.extractBasicColors(content);

        // Second pass: Use NLP for contextual colors
        const nlpColors = this.extractNLPColors(content);

        // Third pass: Use OpenAI for complex color descriptions
        const aiColors = await this.extractAIColors(content);

        // Combine and normalize
        const allColors = [...basicColors, ...nlpColors, ...(aiColors || [])]
            .map(this.normalizeColor);

        return [...new Set(allColors)];
    }

    private extractBasicColors(text: string): string[] {
        const colorRegex =
            /\b(red|blue|green|yellow|purple|orange|brown|black|white|gray|pink|navy|burgundy|teal|gold|silver|bronze|cream|beige|ivory)\b/gi;
        const matches = text.match(colorRegex) || [];
        return [...new Set(matches)];
    }

    private extractNLPColors(content: string): string[] {
        const doc = this.nlp(content);
        const colors = doc.match("#Color").out("array");

        const colorPatterns = [
            /(?:light|dark|deep|bright|pale|soft|warm|cool)\s+[a-z]+/gi,
            /(?:sea|forest|sky|royal|navy|pearl|cream|burgundy|sage|seafoam)[a-z]*/gi,
        ];

        const additionalColors = colorPatterns
            .flatMap((pattern) => content.match(pattern) || [])
            .filter((color) => color.length > 0);

        return [...colors, ...additionalColors];
    }

    private async extractAIColors(content: string): Promise<string[]> {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "user",
                    content:
                        `Extract colors from this text and return them as a comma-separated list: ${content}`,
                }],
                max_tokens: 50,
                temperature: 0.3,
            });

            return response.choices[0].message?.content?.split(",")
                .map((c) => c.trim())
                .filter((c) => c.length > 0) || [];
        } catch (error) {
            console.error("OpenAI API error:", error);
            return [];
        }
    }

    private normalizeColor(color: string): string {
        color = color.toLowerCase().trim();
        color = color.replace(
            /^(light|dark|deep|bright|pale|soft|warm|cool)\s+/,
            "",
        );

        const colorMap: Record<string, string> = {
            "navy blue": "navy",
            "forest green": "forest",
            "sky blue": "sky",
            "royal blue": "royal",
            "seafoam green": "seafoam",
            "pearl white": "pearl",
            "cream white": "cream",
            "burgundy red": "burgundy",
        };

        return colorMap[color] || color;
    }

    async extractDimensions(
        content: string,
    ): Promise<Array<{ value: number; unit: string }>> {
        // First pass: Use regex for basic measurements
        const measurementRegex =
            /(\d+(?:\.\d+)?)\s*(px|em|rem|%|vh|vw|cm|mm|in|pt|pc)/gi;
        const basicMeasurements: Array<{ value: number; unit: string }> = [];
        let match;
        while ((match = measurementRegex.exec(content)) !== null) {
            basicMeasurements.push({
                value: parseFloat(match[1]),
                unit: match[2].toLowerCase(),
            });
        }

        // Second pass: Handle dimension formats like 1920x1080
        const dimensionRegex =
            /(\d+)\s*[x×]\s*(\d+)(?:\s*(px|pixels|em|rem|%|vw|vh|pt|cm|mm|in))?/gi;
        const matches = content.matchAll(dimensionRegex);

        for (const match of matches) {
            const [width, height, unit = "px"] = match.slice(1);
            basicMeasurements.push(
                { value: parseInt(width), unit },
                { value: parseInt(height), unit },
            );
        }

        return basicMeasurements;
    }

    async extractHFTopics(text: string): Promise<string[]> {
        try {
            const response = await this.hf.zeroShotClassification({
                model: "facebook/bart-large-mnli",
                inputs: text,
                parameters: {
                    candidate_labels: [
                        "modern",
                        "minimalist",
                        "technology",
                        "startup",
                        "sustainable",
                        "innovative",
                        "professional",
                        "creative",
                        "digital",
                        "business",
                    ],
                    multi_label: true,
                },
            });

            const result = Array.isArray(response) ? response[0] : response;
            if (result && result.labels && result.scores) {
                return result.labels.filter((_: string, index: number) =>
                    result.scores[index] > 0.8
                );
            }
            return [];
        } catch (error) {
            console.error("Error extracting topics with Hugging Face:", error);
            return [];
        }
    }

    async extractKeywords(content: string): Promise<string[]> {
        // Use keyword-extractor for basic keywords
        const extractResult = keywordExtractor.extract(content, {
            language: "english",
            remove_digits: false,
            return_changed_case: true,
            remove_duplicates: true,
        });
        const basicKeywords = Array.isArray(extractResult) ? extractResult : [];

        // Extract special patterns
        const specialPatterns = {
            hashtags: /#[\w-]+/g,
            mentions: /@[\w-]+/g,
            metrics:
                /\d+(?:\.\d+)?[kKmMbB]?\+?\s*(?:impressions|views|likes|shares|followers)/g,
            ranges:
                /\d+(?:-\d+)?(?:\+)?\s*(?:px|em|rem|%|years?|users?|demographic)/g,
        };

        const specialTerms = Object.values(specialPatterns)
            .flatMap((pattern) => content.match(pattern) || [])
            .map((term) => term.trim());

        return [...new Set([...basicKeywords, ...specialTerms])]
            .filter((k) => k.length > 1)
            .filter((k) => !this.isStopWord(k))
            .map(this.normalizeKeyword);
    }

    private async extractRequirements(
        content: string,
        type: string,
        platform?: string,
    ): Promise<string[]> {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "user",
                    content:
                        `Extract specific requirements and constraints from this creative request. Include both explicit and implicit requirements.
                    Type: ${type}
                    Platform: ${platform || "not specified"}
                    Request: ${content}

                    Format as a bullet-point list of clear, actionable requirements. Include technical specifications, brand guidelines, and platform-specific requirements.`,
                }],
                max_tokens: 200,
                temperature: 0.3,
            });

            const requirements =
                response.choices[0].message?.content?.split("\n")
                    .map((line) => line.replace(/^[•\-\*]\s*/, "").trim())
                    .filter((line) => line.length > 0) || [];

            // Add type-specific requirements
            switch (type) {
                case "social":
                    if (platform) {
                        requirements.push(
                            `Optimize for ${platform} platform specifications`,
                        );
                        if (platform === "instagram") {
                            requirements.push(
                                "Ensure content is visually engaging",
                            );
                            requirements.push(
                                "Consider mobile-first viewing experience",
                            );
                        } else if (platform === "linkedin") {
                            requirements.push("Maintain professional tone");
                            requirements.push(
                                "Include relevant industry insights",
                            );
                        }
                    }
                    break;
                case "merch":
                    requirements.push(
                        "Ensure design is suitable for production",
                    );
                    requirements.push(
                        "Consider material and printing constraints",
                    );
                    break;
                case "logo":
                    requirements.push("Create scalable vector format");
                    requirements.push(
                        "Design must work in both color and monochrome",
                    );
                    break;
                case "website":
                    requirements.push("Ensure responsive design");
                    requirements.push("Follow web accessibility guidelines");
                    break;
                case "creative_writing":
                    requirements.push("Maintain consistent brand voice");
                    requirements.push("Include SEO considerations");
                    break;
            }

            return [...new Set(requirements)];
        } catch (error) {
            console.error("Error extracting requirements:", error);
            return [];
        }
    }

    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            "the",
            "be",
            "to",
            "of",
            "and",
            "a",
            "in",
            "that",
            "have",
            "i",
            "it",
            "for",
            "not",
            "on",
            "with",
            "he",
            "as",
            "you",
            "do",
            "at",
            "this",
            "but",
            "his",
            "by",
            "from",
            "they",
            "we",
            "say",
            "her",
            "she",
            "or",
            "an",
            "will",
            "my",
            "one",
            "all",
            "would",
            "there",
            "their",
            "what",
            "so",
            "up",
            "out",
            "if",
            "about",
            "who",
            "get",
            "which",
            "go",
            "me",
            "make",
            "can",
            "like",
            "time",
            "no",
            "just",
            "him",
            "know",
            "take",
            "people",
            "into",
            "year",
            "your",
            "good",
        ]);
        return stopWords.has(word.toLowerCase());
    }

    private normalizeKeyword(keyword: string): string {
        return keyword
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, " ");
    }

    private async generateStructuredBrief(
        content: string,
        type: string,
        platform?: string,
    ): Promise<string> {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "user",
                    content:
                        `Transform this informal creative request into a clear, concise objective statement.
                    Type: ${type}
                    Platform: ${platform || "not specified"}
                    Request: ${content}

                    Rules:
                    - Start with an action verb
                    - Keep it to one clear sentence
                    - Focus only on the core deliverable and its purpose
                    - Be specific but concise
                    - Don't mention technical details
                    - Use professional language

                    Example 1:
                    Request: "need to do some posts about our new feature launch maybe with some screenshots?"
                    Brief: "Create social media content showcasing our new feature launch through visual demonstrations."

                    Example 2:
                    Request: "thinking we should make a blog post about AI safety and our approach"
                    Brief: "Develop a blog post explaining our approach to AI safety and responsible development."
                    `,
                }],
                max_tokens: 60,
                temperature: 0.3,
            });

            return response.choices[0].message?.content?.trim() || content;
        } catch (error) {
            console.error("Error generating structured brief:", error);
            return content;
        }
    }
}
