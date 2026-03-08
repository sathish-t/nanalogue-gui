// Shared mock server infrastructure for chat-orchestrator tests.

import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";

/** A mock completion response matching the OpenAI chat completions format. */
export interface MockCompletion {
    /** The response choices array. */
    choices: Array<{
        /** The assistant message. */
        message: {
            /** The message role. */
            role: string;
            /** The text content. */
            content?: string | null;
        };
        /** The reason generation stopped. */
        finish_reason: string;
    }>;
    /** Override HTTP status code (default 200). */
    _statusCode?: number;
    /** Delay in ms before responding. */
    _delayMs?: number;
    /** Custom response headers (e.g. Retry-After). */
    _headers?: Record<string, string>;
    /** Return raw body instead of JSON (for malformed response tests). */
    _rawBody?: string;
}

/** Return type of startMockServer. */
export interface MockServer {
    /** The base URL (e.g., http://127.0.0.1:PORT/v1). */
    url: string;
    /** Closes the mock server. */
    close: () => Promise<void>;
    /** Returns the number of requests handled so far. */
    requestCount: () => number;
    /** Returns the captured request bodies in order. */
    requestBodies: () => Array<Record<string, unknown>>;
}

/**
 * Starts a local HTTP server that returns queued OpenAI-compatible responses.
 *
 * @param responses - Queue of response entries to return in sequence.
 * @returns The mock server URL, close function, and request counter.
 */
export async function startMockServer(
    responses: MockCompletion[],
): Promise<MockServer> {
    let idx = 0;
    const capturedBodies: Array<Record<string, unknown>> = [];

    /**
     * Handles incoming HTTP requests by returning queued responses.
     *
     * @param req - The incoming HTTP request.
     * @param res - The server response.
     */
    function handler(req: IncomingMessage, res: ServerResponse): void {
        if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => {
                try {
                    const body = JSON.parse(
                        Buffer.concat(chunks).toString("utf-8"),
                    ) as Record<string, unknown>;
                    capturedBodies.push(body);
                } catch {
                    // Non-JSON body — ignore
                }
                const completion =
                    responses.length === 0
                        ? { choices: [], _statusCode: 500 }
                        : idx < responses.length
                          ? responses[idx]
                          : responses[responses.length - 1];
                idx++;
                const statusCode = completion._statusCode ?? 200;
                const delayMs = completion._delayMs ?? 0;

                /**
                 * Sends the HTTP response with the completion body.
                 */
                const sendResponse = (): void => {
                    res.writeHead(statusCode, {
                        "Content-Type": "application/json",
                        ...(completion._headers ?? {}),
                    });
                    if (completion._rawBody !== undefined) {
                        res.end(completion._rawBody);
                    } else {
                        res.end(
                            JSON.stringify({
                                id: `chatcmpl-${idx}`,
                                object: "chat.completion",
                                created: Math.floor(Date.now() / 1000),
                                model: "test-model",
                                ...completion,
                            }),
                        );
                    }
                };

                if (delayMs > 0) {
                    setTimeout(sendResponse, delayMs);
                } else {
                    sendResponse();
                }
            });
        } else {
            res.writeHead(404);
            res.end("Not found");
        }
    }

    const server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const addr = server.address();
    if (addr === null || typeof addr === "string") {
        throw new Error("Mock server did not bind to a port");
    }
    return {
        url: `http://127.0.0.1:${addr.port}/v1`,
        /** Closes the server and resolves when done. */
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
            }),
        /**
         * Returns the number of requests handled.
         *
         * @returns The request count.
         */
        requestCount: () => idx,
        /**
         * Returns the captured request bodies in order.
         *
         * @returns The request body array.
         */
        requestBodies: () => capturedBodies,
    };
}
