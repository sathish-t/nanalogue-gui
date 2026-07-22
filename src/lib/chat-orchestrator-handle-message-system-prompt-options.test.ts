// End-to-end tests for handleUserMessage system-prompt customization.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleUserMessage, resetLastSentMessages } from "./chat-orchestrator";
import { createAiChatConfig } from "./chat-orchestrator-handle-message-test-utils";
import {
    type MockServer,
    startMockServer,
} from "./chat-orchestrator-test-utils";
import type { Fact, HistoryEntry } from "./chat-types";

describe("appendSystemPrompt", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "append-prompt-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /** Minimal config for append-prompt tests. */
    const cfg = createAiChatConfig();

    /**
     * Calls handleUserMessage with the given appendSystemPrompt and returns
     * the request bodies captured by the mock server.
     *
     * @param appendText - Text to append to the system prompt, or undefined.
     * @param serverUrl - The mock server base URL.
     * @returns The captured LLM request bodies.
     */
    async function callWithAppend(
        appendText: string | undefined,
        serverUrl: string,
    ): Promise<Array<Record<string, unknown>>> {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: serverUrl,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            appendSystemPrompt: appendText,
        });
        return mockServer?.requestBodies() ?? [];
    }

    it("includes appendSystemPrompt content in the system message sent to LLM", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('hello')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithAppend(
            "## Domain context\nThese files are from a cancer methylation study.",
            mockServer.url,
        );

        expect(bodies.length).toBeGreaterThan(0);
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemMsg = messages.find((m) => m.role === "system");
        expect(systemMsg).toBeDefined();
        // Appended content must be present.
        expect(systemMsg?.content).toContain("Domain context");
        expect(systemMsg?.content).toContain("cancer methylation study");
        // Default sandbox prompt content must still be present.
        expect(systemMsg?.content).toContain("read_info");
    });

    it("appended text appears after the sandbox prompt", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('ok')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const appendText = "## Custom instructions\nAlways use read_info.";
        const bodies = await callWithAppend(appendText, mockServer.url);
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        // "## Constraints" is near the end of the sandbox prompt.
        // The custom append must follow it.
        const sandboxEnd = systemContent.indexOf("## Constraints");
        const appendStart = systemContent.indexOf("## Custom instructions");
        expect(sandboxEnd).toBeGreaterThan(-1);
        expect(appendStart).toBeGreaterThan(sandboxEnd);
    });

    it("appended text appears before the facts block", async () => {
        // Pre-seed one fact so that buildSystemPrompt appends a facts block.
        // The expected ordering is: sandbox prompt → append → facts block.
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('ok')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [
            {
                type: "filter",
                description: "mapped reads only",
                roundId: "round-1",
                timestamp: Date.now(),
            },
        ];
        const appendText =
            "## Custom instructions\nAlways use read_info first.";

        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            appendSystemPrompt: appendText,
        });

        const bodies = mockServer.requestBodies();
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        const appendStart = systemContent.indexOf("## Custom instructions");
        const factsStart = systemContent.indexOf("## Conversation facts");
        expect(appendStart).toBeGreaterThan(-1);
        expect(factsStart).toBeGreaterThan(-1);
        expect(appendStart).toBeLessThan(factsStart);
    });

    it("system message is unchanged when appendSystemPrompt is undefined", async () => {
        // Capture system content WITH append.
        // Assign to mockServer so callWithAppend can access requestBodies().
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('a')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);
        const bodiesWith = await callWithAppend(
            "extra instructions",
            mockServer.url,
        );
        await mockServer.close();
        mockServer = undefined;

        // Capture system content WITHOUT append.
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('b')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);
        const bodiesWithout = await callWithAppend(undefined, mockServer.url);

        /**
         * Extracts the system message content from a captured request body list.
         *
         * @param bodies - The captured request bodies.
         * @returns The system message content string.
         */
        function getSystemContent(
            bodies: Array<Record<string, unknown>>,
        ): string {
            const messages = bodies[0].messages as Array<{
                /** Message role. */
                role: string;
                /** Message content. */
                content: string;
            }>;
            return messages.find((m) => m.role === "system")?.content ?? "";
        }

        const withContent = getSystemContent(bodiesWith);
        const withoutContent = getSystemContent(bodiesWithout);

        expect(withContent).toContain("extra instructions");
        expect(withoutContent).not.toContain("extra instructions");
        // Without append the system prompt must be shorter.
        expect(withoutContent.length).toBeLessThan(withContent.length);
    });

    it("/dump_system_prompt includes appendSystemPrompt content in the dump file", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        const result = await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            appendSystemPrompt:
                "## Experiment notes\nSample is from patient cohort A.",
        });

        expect(result.text).toContain("System prompt dumped to");

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        // Both default and appended content must appear in the dump.
        expect(content).toContain("read_info");
        expect(content).toContain("Experiment notes");
        expect(content).toContain("patient cohort A");
    });

    it("/dump_system_prompt without appendSystemPrompt does not include appended content", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
        });

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("read_info");
        expect(content).not.toContain("Experiment notes");
    });
});

describe("replaceSystemPrompt", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "replace-prompt-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /** Minimal config for replace-prompt tests. */
    const cfg = createAiChatConfig();

    /**
     * Calls handleUserMessage with the given replaceSystemPrompt and optional
     * appendSystemPrompt, then returns the captured LLM request bodies.
     *
     * @param replaceText - Text to replace the system prompt with, or undefined.
     * @param serverUrl - The mock server base URL.
     * @param appendText - Optional text to append after the base prompt.
     * @returns The captured LLM request bodies.
     */
    async function callWithReplace(
        replaceText: string | undefined,
        serverUrl: string,
        appendText?: string,
    ): Promise<Array<Record<string, unknown>>> {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: serverUrl,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            replaceSystemPrompt: replaceText,
            appendSystemPrompt: appendText,
        });
        return mockServer?.requestBodies() ?? [];
    }

    it("replaces the default sandbox prompt with the supplied text", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(
            "You are a custom assistant.",
            mockServer.url,
        );

        expect(bodies.length).toBeGreaterThan(0);
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemMsg = messages.find((m) => m.role === "system");
        expect(systemMsg).toBeDefined();
        // Replacement content must be present.
        expect(systemMsg?.content).toContain("You are a custom assistant.");
        // Default sandbox prompt content must NOT be present.
        expect(systemMsg?.content).not.toContain(
            "You are a Python REPL for bioinformatics analysis.",
        );
    });

    it("appendSystemPrompt still stacks on top of replaceSystemPrompt", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(
            "Custom base prompt.",
            mockServer.url,
            "## Appended section\nExtra domain context.",
        );

        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        expect(systemContent).toContain("Custom base prompt.");
        expect(systemContent).toContain("Appended section");
        // Appended text must follow the replacement base.
        const baseIdx = systemContent.indexOf("Custom base prompt.");
        const appendIdx = systemContent.indexOf("## Appended section");
        expect(baseIdx).toBeGreaterThan(-1);
        expect(appendIdx).toBeGreaterThan(baseIdx);
    });

    it("default sandbox prompt content is absent when replaceSystemPrompt is set", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(
            "Completely different instructions.",
            mockServer.url,
        );

        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        // Key phrases unique to the built-in sandbox prompt must not appear.
        expect(systemContent).not.toContain("Python REPL");
        expect(systemContent).not.toContain("bam_mods");
        expect(systemContent).not.toContain("continue_thinking");
    });

    it("when replaceSystemPrompt is undefined the default prompt is used", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(undefined, mockServer.url);

        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        // Default sandbox prompt content must be present.
        expect(systemContent).toContain("Python REPL");
        expect(systemContent).toContain("bam_mods");
    });

    it("/dump_system_prompt writes replacement content, not the default sandbox prompt", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        const result = await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            replaceSystemPrompt: "Custom prompt for dump test.",
        });

        expect(result.text).toContain("System prompt dumped to");

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("Custom prompt for dump test.");
        // Default sandbox prompt content must not appear.
        expect(content).not.toContain("Python REPL");
    });

    it("/dump_system_prompt includes both replacement and appended content", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            replaceSystemPrompt: "Replacement base.",
            appendSystemPrompt: "Appended section.",
        });

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("Replacement base.");
        expect(content).toContain("Appended section.");
        // Replacement must precede the append.
        expect(content.indexOf("Replacement base.")).toBeLessThan(
            content.indexOf("Appended section."),
        );
        // Default sandbox content must not appear.
        expect(content).not.toContain("Python REPL");
    });
});
