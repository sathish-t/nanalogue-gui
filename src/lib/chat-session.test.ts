// Unit tests for the ChatSession class.
// Verifies session state management, cancellation, reset, and delegation to the orchestrator.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiChatConfig } from "./chat-types";

// Mock the orchestrator so tests don't need a real LLM or sandbox
vi.mock("./chat-orchestrator", () => ({
    handleUserMessage: vi.fn(),
    resetLastSentMessages: vi.fn(),
}));

// Import after mock setup so the mock takes effect
const { handleUserMessage, resetLastSentMessages } = await import(
    "./chat-orchestrator"
);
const { ChatSession } = await import("./chat-session");

/** Default config matching GUI fallbacks for test convenience. */
const defaultConfig: AiChatConfig = {
    contextWindowTokens: 32_000,
    maxRetries: 5,
    timeoutSeconds: 120,
    maxCodeRounds: 10,
    maxRecordsReadInfo: 200_000,
    maxRecordsBamMods: 5_000,
    maxRecordsWindowReads: 5_000,
    maxRecordsSeqTable: 5_000,
    maxDurationSecs: 600,
    maxMemoryMB: 512,
    maxAllocations: 100_000,
    maxReadMB: 1,
    maxWriteMB: 50,
};

describe("ChatSession", () => {
    let session: InstanceType<typeof ChatSession>;

    beforeEach(() => {
        session = new ChatSession();
        vi.mocked(handleUserMessage).mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("sendMessage", () => {
        it("calls handleUserMessage with correct arguments", async () => {
            vi.mocked(handleUserMessage).mockResolvedValue({
                text: "hello",
                steps: [],
            });

            const emitEvent = vi.fn();
            await session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "How many reads?",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent,
            });

            expect(handleUserMessage).toHaveBeenCalledOnce();
            const args = vi.mocked(handleUserMessage).mock.calls[0][0];
            expect(args.message).toBe("How many reads?");
            expect(args.endpointUrl).toBe("http://localhost:11434/v1");
            expect(args.apiKey).toBe("");
            expect(args.model).toBe("llama3");
            expect(args.allowedDir).toBe("/tmp");
            expect(args.config).toEqual(defaultConfig);
            expect(args.emitEvent).toBe(emitEvent);
            expect(args.signal).toBeInstanceOf(AbortSignal);
            expect(args.history).toEqual(expect.any(Array));
            expect(args.facts).toEqual(expect.any(Array));
        });

        it("returns the orchestrator result on success", async () => {
            vi.mocked(handleUserMessage).mockResolvedValue({
                text: "42 reads",
                steps: [
                    {
                        code: "read_info('test.bam')",
                        result: { success: true, value: 42 },
                    },
                ],
            });

            const result = await session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "Count reads",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            });

            expect(result).toEqual({
                success: true,
                text: "42 reads",
                steps: [
                    {
                        code: "read_info('test.bam')",
                        result: { success: true, value: 42 },
                    },
                ],
            });
        });

        it("increments requestId on each call", async () => {
            vi.mocked(handleUserMessage).mockResolvedValue({
                text: "",
                steps: [],
            });

            const opts = {
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            };

            await session.sendMessage(opts);
            await session.sendMessage(opts);
            await session.sendMessage(opts);

            expect(session.requestId).toBe(3);
        });

        it("aborts previous request when sending a new one", async () => {
            let capturedSignal = null as AbortSignal | null;
            vi.mocked(handleUserMessage).mockImplementation(async (opts) => {
                capturedSignal = opts.signal;
                return { text: "", steps: [] };
            });

            const opts = {
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            };

            await session.sendMessage(opts);
            const firstSignal = capturedSignal;
            expect(firstSignal).not.toBeNull();

            await session.sendMessage(opts);
            // The first signal should have been aborted
            expect(firstSignal?.aborted).toBe(true);
        });
    });

    describe("cancel", () => {
        it("aborts the current abort controller", async () => {
            let capturedSignal = null as AbortSignal | null;
            vi.mocked(handleUserMessage).mockImplementation(async (opts) => {
                capturedSignal = opts.signal;
                return { text: "", steps: [] };
            });

            await session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            });

            expect(capturedSignal).not.toBeNull();
            expect(capturedSignal?.aborted).toBe(false);

            session.cancel();
            expect(capturedSignal?.aborted).toBe(true);
        });

        it("increments requestId when cancelling", async () => {
            vi.mocked(handleUserMessage).mockResolvedValue({
                text: "",
                steps: [],
            });

            await session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            });

            const idBefore = session.requestId;
            session.cancel();
            expect(session.requestId).toBe(idBefore + 1);
        });

        it("is safe to call when no request is in flight", () => {
            expect(() => session.cancel()).not.toThrow();
        });
    });

    describe("reset", () => {
        it("clears history and facts", async () => {
            vi.mocked(handleUserMessage).mockImplementation(async (opts) => {
                // Simulate adding to history/facts inside orchestrator
                opts.history.push({ role: "user", content: "test" });
                opts.facts.push({
                    type: "file",
                    filename: "x.bam",
                    roundId: "round-1",
                    timestamp: 1,
                });
                return { text: "", steps: [] };
            });

            await session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            });

            // State should be populated
            expect(session.history.length).toBeGreaterThan(0);
            expect(session.facts.length).toBeGreaterThan(0);

            session.reset();

            expect(session.history).toHaveLength(0);
            expect(session.facts).toHaveLength(0);
        });

        it("calls resetLastSentMessages to clear dump state", () => {
            session.reset();
            expect(resetLastSentMessages).toHaveBeenCalled();
        });

        it("aborts current request and increments requestId", async () => {
            let capturedSignal = null as AbortSignal | null;
            vi.mocked(handleUserMessage).mockImplementation(async (opts) => {
                capturedSignal = opts.signal;
                return { text: "", steps: [] };
            });

            await session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent: vi.fn(),
            });

            const idBefore = session.requestId;
            session.reset();

            expect(capturedSignal?.aborted).toBe(true);
            expect(session.requestId).toBe(idBefore + 1);
        });
    });

    describe("stale response detection", () => {
        it("returns cancelled when signal is aborted during request", async () => {
            vi.mocked(handleUserMessage).mockImplementation(async (opts) => {
                // Simulate abort during execution
                opts.signal.addEventListener(
                    "abort",
                    () => {
                        /* no-op */
                    },
                    { once: true },
                );
                throw new DOMException("Aborted", "AbortError");
            });

            const emitEvent = vi.fn();
            const result = session.sendMessage({
                endpointUrl: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3",
                message: "test",
                allowedDir: "/tmp",
                config: defaultConfig,
                emitEvent,
            });

            // Cancel while request is pending
            session.cancel();

            const outcome = await result;
            expect(outcome).toEqual({
                success: false,
                error: "Cancelled",
            });
        });
    });
});
