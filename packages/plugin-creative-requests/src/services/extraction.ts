import compromise from "compromise";
import natural from "natural";
import colorNamer from "color-namer";
import { OpenAI } from "openai";
import keywordExtractor from "keyword-extractor";
import { mean, standardDeviation } from "simple-statistics";
import * as tf from "@tensorflow/tfjs-node";
import { HfInference } from "@huggingface/inference";

export class ExtractionService {
    private nlp: typeof compromise;
    private tokenizer: natural.WordTokenizer;
    private classifier: natural.BayesClassifier;
    private tfidf: natural.TfIdf;
    private openai: OpenAI;
    private hf: HfInference;
    private model: tf.LayersModel | null = null;

    constructor(openaiApiKey: string, hfApiKey: string) {
        console.log("ExtractionService constructor called with keys:", {
            openaiKeyLength: openaiApiKey.length,
            hfKeyLength: hfApiKey.length,
            openaiKeyStart: openaiApiKey.substring(0, 7),
            hfKeyStart: hfApiKey.substring(0, 7),
        });

        // Initialize NLP tools
        this.nlp = compromise;
        this.tokenizer = new natural.WordTokenizer();
        this.classifier = new natural.BayesClassifier();
        this.tfidf = new natural.TfIdf();

        // Initialize OpenAI with configuration
        this.openai = new OpenAI({
            apiKey: openaiApiKey,
            baseURL: "https://api.openai.com/v1", // Explicitly set the base URL
            maxRetries: 3,
            timeout: 30000, // 30 seconds
        });

        // Initialize Hugging Face
        this.hf = new HfInference(hfApiKey);

        // Load TensorFlow model
        this.loadModel();
    }

    private async loadModel() {
        try {
            // Load a pre-trained model for pattern recognition
            this.model = await tf.loadLayersModel(
                "https://storage.googleapis.com/tfjs-models/tfjs/sentiment_cnn_v1/model.json",
            );
        } catch (error) {
            console.error("Error loading TensorFlow model:", error);
        }
    }

    async predictPattern(
        input: Record<string, number>,
    ): Promise<Record<string, number>> {
        if (!this.model) {
            throw new Error("Model not loaded");
        }
        const tensor = tf.tensor2d([Object.values(input)]);
        const prediction = this.model.predict(tensor) as tf.Tensor;
        const values = await prediction.data();
        tensor.dispose();
        prediction.dispose();

        return Object.keys(input).reduce((acc, key, index) => {
            acc[key] = values[index];
            return acc;
        }, {} as Record<string, number>);
    }

    async extractColors(content: string): Promise<string[]> {
        // First pass: Use color-namer for hex colors
        const basicColors = this.extractBasicColors(content);

        // Second pass: Use NLP for contextual color mentions
        const nlpColors = this.extractNLPColors(content);

        // Third pass: Use OpenAI for complex color descriptions
        const aiColors = await this.extractAIColors(content);

        // Fourth pass: Use Hugging Face for color detection
        const hfColors = await this.extractHFColors(content);

        // Combine all colors and normalize them
        const allColors = [
            ...basicColors,
            ...nlpColors,
            ...(aiColors || []),
            ...(hfColors || []),
        ].map(this.normalizeColor);

        // Remove duplicates while preserving hex colors
        const hexColors = allColors.filter((c) => c.startsWith("#"));
        const namedColors = allColors.filter((c) => !c.startsWith("#"));

        return [
            ...new Set([
                ...hexColors,
                ...namedColors,
            ]),
        ];
    }

    extractBasicColors(text: string): string[] {
        try {
            // Extract color-related words using regex
            const colorRegex =
                /\b(red|blue|green|yellow|purple|orange|brown|black|white|gray|pink|navy|burgundy|teal|gold|silver|bronze|cream|beige|ivory)\b/gi;
            const matches = text.match(colorRegex) || [];
            return [...new Set(matches)];
        } catch (error) {
            console.error("Error extracting basic colors:", error);
            return [];
        }
    }

    private extractNLPColors(content: string): string[] {
        const doc = this.nlp(content);
        const colors = doc.match("#Color").out("array");

        // Add custom color pattern matching
        const colorPatterns = [
            /(?:light|dark|deep|bright|pale|soft|warm|cool)\s+[a-z]+/gi,
            /(?:sea|forest|sky|royal|navy|pearl|cream|burgundy|sage|seafoam)[a-z]*/gi,
        ];

        const additionalColors = colorPatterns
            .flatMap((pattern) => content.match(pattern) || [])
            .filter((color) => color.length > 0);

        return [...colors, ...additionalColors].map(this.normalizeColor);
    }

    private normalizeColor(color: string): string {
        // Convert to lowercase and trim
        color = color.toLowerCase().trim();

        // Remove common prefixes/suffixes
        color = color.replace(
            /^(light|dark|deep|bright|pale|soft|warm|cool)\s+/,
            "",
        );

        // Normalize common color names
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

    private async extractAIColors(content: string): Promise<string[]> {
        try {
            console.log(
                "Calling OpenAI API with key length:",
                this.openai.apiKey.length,
            );
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "user",
                    content:
                        `Extract colors from this text and return them as a comma-separated list.
                        Include both explicit colors and descriptive colors. Format each color consistently:
                        - For hex colors, keep the hex format (#RRGGBB)
                        - For descriptive colors, use the format: [tone] [base color] (e.g., "deep blue", "light green")
                        - For special colors, keep their full description (e.g., "seafoam", "burgundy")

                        Text: ${content}`,
                }],
                max_tokens: 100,
                temperature: 0.3,
            });

            const colorText = response.choices[0].message?.content || "";
            return colorText.split(",")
                .map((c) => c.trim())
                .filter((c) => c.length > 0)
                .map(this.normalizeColor);
        } catch (error) {
            console.error("OpenAI API error:", error);
            return [];
        }
    }

    async extractHFColors(text: string): Promise<string[]> {
        try {
            const response = await this.hf.textClassification({
                model: "j-hartmann/emotion-english-distilroberta-base",
                inputs: text,
            });

            // Convert the response to a more specific type
            const result = Array.isArray(response) ? response[0] : response;
            if (result && result.label && result.score > 0.5) {
                // Extract color-related words using regex
                const colorRegex =
                    /\b(red|blue|green|yellow|purple|orange|brown|black|white|gray|pink|navy|burgundy|teal|gold|silver|bronze|cream|beige|ivory)\b/gi;
                const matches = text.match(colorRegex) || [];
                return [...new Set(matches)];
            }
            return [];
        } catch (error) {
            console.error("Error extracting colors with Hugging Face:", error);
            return [];
        }
    }

    async extractHFMaterials(text: string): Promise<string[]> {
        try {
            const response = await this.hf.textClassification({
                model: "j-hartmann/emotion-english-distilroberta-base",
                inputs: text,
            });

            // Convert the response to a more specific type
            const result = Array.isArray(response) ? response[0] : response;
            if (result && result.label && result.score > 0.5) {
                // Extract material-related words using regex
                const materialRegex =
                    /\b(wood|metal|glass|plastic|paper|fabric|leather|stone|ceramic|bamboo|cardboard|steel|aluminum|copper|marble|granite|cotton|silk|wool|polyester)\b/gi;
                const matches = text.match(materialRegex) || [];
                return [...new Set(matches)];
            }
            return [];
        } catch (error) {
            console.error(
                "Error extracting materials with Hugging Face:",
                error,
            );
            return [];
        }
    }

    private async extractHFEmotions(
        content: string,
    ): Promise<Record<string, number>> {
        try {
            const emotionResponse = await this.hf.textClassification({
                model: "SamLowe/roberta-base-go_emotions",
                inputs: content,
            });

            // Convert scores to emotion map
            return emotionResponse.reduce(
                (
                    acc: Record<string, number>,
                    item: { label: string; score: number },
                ) => {
                    acc[item.label] = item.score;
                    return acc;
                },
                {},
            );
        } catch (error) {
            console.error(
                "Error extracting emotions with Hugging Face:",
                error,
            );
            return {};
        }
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

            // Handle array response
            const result = Array.isArray(response) ? response[0] : response;

            if (result && result.labels && result.scores) {
                return result.labels.filter((_: string, index: number) =>
                    result.scores[index] > 0.8 // Using a higher threshold since scores are very high
                );
            }
            return [];
        } catch (error) {
            console.error("Error extracting topics with Hugging Face:", error);
            return [];
        }
    }

    async analyzeContent(content: string): Promise<{
        colors: string[];
        materials: string[];
        emotions: Record<string, number>;
        topics: string[];
    }> {
        const [colors, materials, emotions, topics] = await Promise.all([
            this.extractHFColors(content),
            this.extractHFMaterials(content),
            this.extractHFEmotions(content),
            this.extractHFTopics(content),
        ]);

        return {
            colors,
            materials,
            emotions,
            topics,
        };
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

        // Second pass: Use NLP for contextual measurements
        const nlpMeasurements = this.extractNLPDimensions(content);

        return [...basicMeasurements, ...nlpMeasurements];
    }

    async extractKeywords(content: string): Promise<string[]> {
        // Reset TF-IDF state for fresh analysis
        this.tfidf = new natural.TfIdf();

        // First pass: Use keyword-extractor for basic keywords
        const extractResult = keywordExtractor.extract(content, {
            language: "english",
            remove_digits: false,
            return_changed_case: true,
            remove_duplicates: true,
        });
        const basicKeywords = Array.isArray(extractResult) ? extractResult : [];

        // Second pass: Extract special patterns
        const specialPatterns = {
            hashtags: /#[\w-]+/g,
            mentions: /@[\w-]+/g,
            metrics:
                /\d+(?:\.\d+)?[kKmMbB]?\+?\s*(?:impressions|views|likes|shares|followers)/g,
            ranges:
                /\d+(?:-\d+)?(?:\+)?\s*(?:px|em|rem|%|years?|users?|demographic)/g,
            dates: /(?:Q[1-4]|H[1-2])?\s*\d{4}/g,
        };

        const specialTerms = Object.values(specialPatterns)
            .flatMap((pattern) => content.match(pattern) || [])
            .map((term) => term.trim());

        // Third pass: Use TF-IDF for importance scoring
        this.tfidf.addDocument(content);
        const tfidfKeywords = this.tfidf.listTerms(0)
            .filter((item) => item.tfidf > 3.0) // Only keep high-scoring terms
            .slice(0, 5) // Limit to top 5 important terms
            .map((item) => item.term);

        // Combine all keywords
        const allKeywords = [
            ...basicKeywords,
            ...specialTerms,
            ...tfidfKeywords,
        ];

        // Clean and normalize keywords
        return [
            ...new Set(
                allKeywords
                    .map((k) => k.toLowerCase())
                    .filter((k) => k.length > 1)
                    .filter((k) => !this.isStopWord(k))
                    .map((k) => this.normalizeKeyword(k))
                    .filter((k) => k.length > 0), // Remove empty strings after normalization
            ),
        ];
    }

    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            "re",
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
        ]);
        return stopWords.has(word.toLowerCase());
    }

    private normalizeKeyword(keyword: string): string {
        // Handle compound terms
        const compounds = {
            "eco friendly": "eco-friendly",
            "high end": "high-end",
            "zero waste": "zero-waste",
            "mobile first": "mobile-first",
            "user friendly": "user-friendly",
            "cross platform": "cross-platform",
            "open source": "open-source",
            "real time": "real-time",
            "e commerce": "e-commerce",
            "b2b": "business-to-business",
            "b2c": "business-to-consumer",
            "ai powered": "ai-powered",
            "cloud based": "cloud-based",
            "data driven": "data-driven",
            "user generated": "user-generated",
            "social media": "social-media",
        };

        // Check for compound terms
        for (const [original, normalized] of Object.entries(compounds)) {
            if (keyword.includes(original)) {
                return normalized;
            }
        }

        // Clean up special characters while preserving meaningful ones
        return keyword
            .trim()
            .replace(/[^\w\s#@%+-]/g, "") // Keep only word chars, spaces, and special chars
            .replace(/\s+/g, "-") // Replace spaces with hyphens
            .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
    }

    async analyzeSentiment(content: string): Promise<{
        score: number;
        confidence: number;
        aspects: Record<string, number>;
    }> {
        try {
            // First pass: Use natural's sentiment analyzer
            const analyzer = new natural.SentimentAnalyzer(
                "English",
                natural.PorterStemmer,
                "afinn",
            );
            const tokens = this.tokenizer.tokenize(content) || [];
            const basicScore = analyzer.getSentiment(tokens);

            // Second pass: Use compromise for aspect-based sentiment
            const doc = this.nlp(content);
            const aspects = this.extractAspectSentiments(doc);

            // Third pass: Use OpenAI for nuanced sentiment
            const aiSentiment = await this.extractAISentiment(content);

            // Combine results with confidence scoring
            const scores = [
                basicScore || 0,
                ...Object.values(aspects),
                aiSentiment.score,
            ].filter((score) => !isNaN(score));

            if (scores.length === 0) {
                return {
                    score: 0,
                    confidence: 0,
                    aspects,
                };
            }

            return {
                score: mean(scores),
                confidence: 1 -
                    (scores.length > 1 ? standardDeviation(scores) : 0),
                aspects,
            };
        } catch (error) {
            console.error("Error in sentiment analysis:", error);
            return {
                score: 0,
                confidence: 0,
                aspects: {},
            };
        }
    }

    extractNLPDimensions(text: string): Array<{ value: number; unit: string }> {
        try {
            // Handle common dimension formats like 1920x1080 or 200x200
            const dimensionRegex =
                /(\d+)\s*[x×]\s*(\d+)(?:\s*(px|pixels|em|rem|%|vw|vh|pt|cm|mm|in))?/gi;
            const matches = text.matchAll(dimensionRegex);
            const dimensions: Array<{ value: number; unit: string }> = [];

            for (const match of matches) {
                const [width, height, unit = "px"] = match.slice(1);
                dimensions.push(
                    { value: parseInt(width), unit },
                    { value: parseInt(height), unit },
                );
            }

            // Also handle single measurements
            const singleMeasureRegex =
                /(\d+(?:\.\d+)?)\s*(px|pixels|em|rem|%|vw|vh|pt|cm|mm|in)/gi;
            const singleMatches = text.matchAll(singleMeasureRegex);

            for (const match of singleMatches) {
                const [_, value, unit] = match;
                if (
                    !dimensions.some((d) =>
                        d.value === parseFloat(value) && d.unit === unit
                    )
                ) {
                    dimensions.push({
                        value: parseFloat(value),
                        unit: unit.toLowerCase(),
                    });
                }
            }

            return dimensions;
        } catch (error) {
            console.error("Error extracting dimensions:", error);
            return [];
        }
    }

    private async extractAIDimensions(
        content: string,
    ): Promise<Array<{ value: number; unit: string }>> {
        const response = await this.openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "user",
                content:
                    `Extract measurements and dimensions from this text. Return as JSON array with value and unit properties: ${content}`,
            }],
            max_tokens: 100,
        });

        try {
            return JSON.parse(response.choices[0].message?.content || "[]");
        } catch {
            return [];
        }
    }

    private async extractAIKeywords(content: string): Promise<string[]> {
        const response = await this.openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "user",
                content:
                    `Extract key terms and concepts from this text as a comma-separated list: ${content}`,
            }],
            max_tokens: 100,
        });

        return response.choices[0].message?.content?.split(",").map((k) =>
            k.trim()
        ) || [];
    }

    private extractAspectSentiments(doc: any): Record<string, number> {
        const aspects: Record<string, number> = {};

        // Extract noun phrases and analyze their surrounding context
        doc.match("#Noun+").forEach((phrase: any) => {
            const aspect = phrase.text().toLowerCase();
            const context = phrase.lookBehind("#Adjective").concat(
                phrase.lookAhead("#Adjective"),
            );

            // Simple scoring based on positive/negative adjectives
            let score = 0;
            context.forEach((adj: any) => {
                const text = adj.text().toLowerCase();
                if (
                    text.match(
                        /good|great|excellent|amazing|stunning|beautiful|clean|professional/,
                    )
                ) {
                    score += 1;
                } else if (
                    text.match(
                        /bad|poor|terrible|horrible|ugly|messy|unprofessional/,
                    )
                ) {
                    score -= 1;
                }
            });

            if (score !== 0) {
                aspects[aspect] = score;
            }
        });

        return aspects;
    }

    private async extractAISentiment(
        content: string,
    ): Promise<{ score: number }> {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "user",
                    content:
                        `Analyze the sentiment of this text and return a JSON object with a 'score'
                        property between -1 (very negative) and 1 (very positive). Consider both the overall
                        tone and specific aspects mentioned.

                        Text: "${content}"

                        Response format:
                        {
                            "score": number // between -1 and 1
                        }`,
                }],
                max_tokens: 50,
                temperature: 0.3,
            });

            const result = JSON.parse(
                response.choices[0].message?.content || '{"score": 0}',
            );
            return { score: result.score };
        } catch (error) {
            console.error("Error in AI sentiment analysis:", error);
            return { score: 0 };
        }
    }

    // Add more extraction methods as needed...
}
