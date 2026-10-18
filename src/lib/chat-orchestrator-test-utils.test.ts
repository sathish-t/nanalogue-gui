// Tests for the mock HTTP server shared by chat orchestrator integration tests.

import { describe, expect, it } from "vitest";
import { startMockServer } from "./chat-orchestrator-test-utils";

describe("startMockServer utility", () => {
    it("falls back to HTTP 500 when started with an empty responses array", async () => {
        const server = await startMockServer([]);
        const res = await fetch(`${server.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [] }),
        });
        await server.close();
        expect(res.status).toBe(500);
    });

    it("returns HTTP 404 for requests to non-matching routes", async () => {
        const server = await startMockServer([]);
        const res = await fetch(`${server.url}/other`, { method: "GET" });
        await server.close();
        expect(res.status).toBe(404);
    });

    it("honours _delayMs by responding after the specified delay", async () => {
        const server = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "ok" },
                        finish_reason: "stop",
                    },
                ],
                _delayMs: 50,
            },
        ]);
        const start = performance.now();
        const res = await fetch(`${server.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [] }),
        });
        const elapsed = performance.now() - start;
        await server.close();
        expect(res.status).toBe(200);
        expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("ignores non-JSON client request bodies without throwing", async () => {
        const server = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "ok" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);
        const res = await fetch(`${server.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "not json",
        });
        await server.close();
        expect(res.status).toBe(200);
    });
});
