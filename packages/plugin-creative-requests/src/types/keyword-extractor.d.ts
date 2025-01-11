declare module "keyword-extractor" {
    interface ExtractorOptions {
        language?: string;
        remove_digits?: boolean;
        return_changed_case?: boolean;
        remove_duplicates?: boolean;
    }

    const keywordExtractor: {
        extract: (text: string, options?: ExtractorOptions) => string[];
    };

    export default keywordExtractor;
}
