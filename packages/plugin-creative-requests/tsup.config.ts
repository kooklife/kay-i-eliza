import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts", "src/test/test-oauth.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm", "cjs"],
    dts: true,
    external: [
        "compromise",
        "natural",
        "color-namer",
        "openai",
        "brain.js",
        "simple-statistics",
        "keyword-extractor",
    ],
});
