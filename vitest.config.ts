// Vitest configuration for nanalogue-gui

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        coverage: {
            include: ["src/**/*.ts"],
            exclude: [
                // Tests and type-only modules have no production runtime branches.
                "src/**/*.test.ts",
                "src/lib/chat-types.ts",
                "src/lib/types.ts",
                "src/renderer/ai-chat/ai-chat-types.ts",
                "src/renderer/qc/qc-results-types.ts",
                // Process entry points are exercised through built CLI and smoke tests.
                "src/cli.ts",
                "src/execute-cli.ts",
                "src/exit-watchdog.ts",
                "src/main.ts",
                "src/renderer/landing/landing.ts",
            ],
        },
    },
});
