// Tests for model-listing provider detection and model fetching.
// Verifies detectProvider and fetchModels against real HTTP servers.

import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { detectProvider, fetchModels } from "./model-listing";

describe("detectProvider", () => {
    it('returns "anthropic" for api.anthropic.com', () => {
        expect(detectProvider("https://api.anthropic.com/v1")).toBe(
            "anthropic",
        );
    });

    it('returns "google-gemini" for generativelanguage.googleapis.com', () => {
        expect(
            detectProvider("https://generativelanguage.googleapis.com/v1beta"),
        ).toBe("google-gemini");
    });

    it('returns "openai-compat" for localhost', () => {
        expect(detectProvider("http://localhost:11434/v1")).toBe(
            "openai-compat",
        );
    });

    it('returns "openai-compat" for api.openai.com', () => {
        expect(detectProvider("https://api.openai.com/v1")).toBe(
            "openai-compat",
        );
    });

    it('returns "openai-compat" for api.groq.com', () => {
        expect(detectProvider("https://api.groq.com/openai/v1")).toBe(
            "openai-compat",
        );
    });

    it('returns "openai-compat" for unparseable URLs', () => {
        expect(detectProvider("not a url")).toBe("openai-compat");
    });
});

/** Return type of startModelServer. */
interface MockModelServer {
    /** The base URL (e.g., http://127.0.0.1:PORT). */
    url: string;
    /** Closes the mock server. */
    close: () => Promise<void>;
}

/**
 * Starts a mock HTTP server that responds to GET /models with the given status and body.
 *
 * @param statusCode - The HTTP status code to return.
 * @param body - The JSON body to return (omitted for error-only responses).
 * @returns The mock server URL and a close function.
 */
function startModelServer(
    statusCode: number,
    body?: unknown,
): Promise<MockModelServer> {
    return new Promise((resolve) => {
        const server: Server = createServer(
            (_req: IncomingMessage, res: ServerResponse) => {
                res.writeHead(statusCode, {
                    "Content-Type": "application/json",
                });
                res.end(body !== undefined ? JSON.stringify(body) : "");
            },
        );
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (typeof addr !== "object" || addr === null) {
                throw new Error("Failed to get server address");
            }
            resolve({
                url: `http://127.0.0.1:${addr.port}`,
                /** Shuts down the mock server. */
                close: () =>
                    new Promise<void>((res) => server.close(() => res())),
            });
        });
    });
}

/**
 * Starts a mock HTTP server with a custom request handler.
 *
 * @param handler - The request handler for incoming HTTP requests.
 * @returns The mock server URL and a close function.
 */
function startCustomServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<MockModelServer> {
    return new Promise((resolve) => {
        const server = createServer(handler);
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (typeof addr !== "object" || addr === null) {
                throw new Error("Failed to get server address");
            }
            resolve({
                url: `http://127.0.0.1:${addr.port}`,
                /** Shuts down the mock server. */
                close: () =>
                    new Promise<void>((res) => server.close(() => res())),
            });
        });
    });
}

describe("fetchModels (openai-compat)", () => {
    let server: MockModelServer | null = null;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = null;
        }
    });

    it("parses a standard OpenAI model list", async () => {
        server = await startModelServer(200, {
            data: [{ id: "gpt-4" }, { id: "gpt-3.5-turbo" }],
        });
        const result = await fetchModels(
            server.url,
            "test-key",
            "openai-compat",
        );
        expect(result).toEqual({
            success: true,
            models: ["gpt-4", "gpt-3.5-turbo"],
        });
    });

    it("returns auth error for 401", async () => {
        server = await startModelServer(401);
        const result = await fetchModels(
            server.url,
            "bad-key",
            "openai-compat",
        );
        expect(result).toEqual({
            success: false,
            error: "Authentication failed \u2014 check your API key",
        });
    });

    it("returns auth error for 403", async () => {
        server = await startModelServer(403);
        const result = await fetchModels(
            server.url,
            "bad-key",
            "openai-compat",
        );
        expect(result).toEqual({
            success: false,
            error: "Authentication failed \u2014 check your API key",
        });
    });

    it("returns 404 guidance message", async () => {
        server = await startModelServer(404);
        const result = await fetchModels(
            server.url,
            "test-key",
            "openai-compat",
        );
        expect(result).toEqual({
            success: false,
            error: "Endpoint does not support model listing \u2014 type a model name manually",
        });
    });

    it("returns error for malformed response (missing data field)", async () => {
        server = await startModelServer(200, { models: ["gpt-4"] });
        const result = await fetchModels(
            server.url,
            "test-key",
            "openai-compat",
        );
        expect(result).toEqual({
            success: false,
            error: "Unexpected response format from endpoint",
        });
    });

    it("returns empty list for empty data array", async () => {
        server = await startModelServer(200, { data: [] });
        const result = await fetchModels(
            server.url,
            "test-key",
            "openai-compat",
        );
        expect(result).toEqual({
            success: true,
            models: [],
        });
    });
});

describe("fetchModels (anthropic)", () => {
    let server: MockModelServer | null = null;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = null;
        }
    });

    it("parses Anthropic model list", async () => {
        server = await startModelServer(200, {
            data: [
                { id: "claude-sonnet-4-20250514" },
                { id: "claude-haiku-4-20250514" },
            ],
        });
        const result = await fetchModels(server.url, "test-key", "anthropic");
        expect(result).toEqual({
            success: true,
            models: ["claude-sonnet-4-20250514", "claude-haiku-4-20250514"],
        });
    });

    it("sends x-api-key and anthropic-version headers", async () => {
        /** Captured headers from the incoming request. */
        let capturedHeaders: Record<string, string | string[] | undefined> = {};

        server = await startCustomServer(
            (req: IncomingMessage, res: ServerResponse) => {
                capturedHeaders = req.headers;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        data: [{ id: "claude-sonnet-4-20250514" }],
                    }),
                );
            },
        );

        await fetchModels(server.url, "sk-ant-test-key", "anthropic");

        expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test-key");
        expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
        expect(capturedHeaders.authorization).toBeUndefined();
    });

    it("returns auth error for 401", async () => {
        server = await startModelServer(401);
        const result = await fetchModels(server.url, "bad-key", "anthropic");
        expect(result).toEqual({
            success: false,
            error: "Authentication failed \u2014 check your API key",
        });
    });
});

describe("fetchModels (google-gemini)", () => {
    let server: MockModelServer | null = null;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = null;
        }
    });

    it("parses Gemini model list and strips models/ prefix", async () => {
        server = await startModelServer(200, {
            models: [
                { name: "models/gemini-2.0-flash" },
                { name: "models/gemini-1.5-pro" },
            ],
        });
        const result = await fetchModels(
            server.url,
            "test-key",
            "google-gemini",
        );
        expect(result).toEqual({
            success: true,
            models: ["gemini-2.0-flash", "gemini-1.5-pro"],
        });
    });

    it("passes API key as query parameter", async () => {
        /** Captured request URL from the incoming request. */
        let capturedUrl = "";

        server = await startCustomServer(
            (req: IncomingMessage, res: ServerResponse) => {
                capturedUrl = req.url ?? "";
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        models: [{ name: "models/gemini-2.0-flash" }],
                    }),
                );
            },
        );

        await fetchModels(server.url, "my-gem-key", "google-gemini");

        expect(capturedUrl).toContain("key=my-gem-key");
    });

    it("does not send authorization header", async () => {
        /** Captured headers from the incoming request. */
        let capturedHeaders: Record<string, string | string[] | undefined> = {};

        server = await startCustomServer(
            (req: IncomingMessage, res: ServerResponse) => {
                capturedHeaders = req.headers;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        models: [{ name: "models/gemini-2.0-flash" }],
                    }),
                );
            },
        );

        await fetchModels(server.url, "my-gem-key", "google-gemini");

        expect(capturedHeaders.authorization).toBeUndefined();
    });

    it("returns auth error for 403", async () => {
        server = await startModelServer(403);
        const result = await fetchModels(
            server.url,
            "bad-key",
            "google-gemini",
        );
        expect(result).toEqual({
            success: false,
            error: "Authentication failed \u2014 check your API key",
        });
    });

    it("handles missing models field", async () => {
        server = await startModelServer(200, { data: [] });
        const result = await fetchModels(
            server.url,
            "test-key",
            "google-gemini",
        );
        expect(result).toEqual({
            success: false,
            error: "Unexpected response format from endpoint",
        });
    });

    it("returns empty list for empty models array", async () => {
        server = await startModelServer(200, { models: [] });
        const result = await fetchModels(
            server.url,
            "test-key",
            "google-gemini",
        );
        expect(result).toEqual({
            success: true,
            models: [],
        });
    });
});

describe("fetchModels (error handling)", () => {
    let server: MockModelServer | null = null;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = null;
        }
    });

    it("returns network error for unreachable endpoint", async () => {
        // Port 1 is always unreachable on loopback.
        const result = await fetchModels("http://127.0.0.1:1", "key");
        expect(result).toEqual({
            success: false,
            error: "Could not reach endpoint",
        });
    });

    it("returns timeout error when request times out", async () => {
        server = await startCustomServer(() => {
            // Never respond — let it time out.
        });
        const result = await fetchModels(server.url, "key", undefined, 100);
        expect(result).toEqual({
            success: false,
            error: "Request timed out",
        });
    }, 5000);
});
