// Tests for chat provider endpoint URL, API key, and model input validation.

import { describe, expect, it } from "vitest";
import {
    isValidApiKey,
    isValidEndpointUrl,
    isValidModel,
} from "./chat-provider-input-checks";

describe("isValidEndpointUrl", () => {
    it.each([
        "http://localhost:11434/v1",
        "https://api.example.com/v1/chat?mode=fast",
        "https://127.0.0.1:8080",
        "https://[::1]:8080/v1",
    ])("accepts the HTTP or HTTPS endpoint %j", (endpointUrl) => {
        expect(isValidEndpointUrl(endpointUrl)).toBe(true);
    });

    it("accepts an endpoint URL at the length limit", () => {
        const endpointUrl = `https://example.com/${"u".repeat(980)}`;
        expect(endpointUrl).toHaveLength(1000);
        expect(isValidEndpointUrl(endpointUrl)).toBe(true);
    });

    it.each([
        "",
        "example.com/v1",
        "ftp://example.com/v1",
        "https://",
        "https:///example.com/v1",
        "https:////example.com/v1",
        "https://example.com\\v1",
        "https://example.com:invalid/v1",
        "https://example.com/a path",
        "https://example.com/\u0085path",
        "https://alice@example.com/v1",
        "https://:password@example.com/v1",
        " https://example.com/v1",
        "https://example.com/v1 ",
    ])("rejects the invalid endpoint URL %j", (endpointUrl) => {
        expect(isValidEndpointUrl(endpointUrl)).toBe(false);
    });

    it("rejects an endpoint URL longer than 1000 characters", () => {
        expect(
            isValidEndpointUrl(`https://example.com/${"u".repeat(981)}`),
        ).toBe(false);
    });
});

describe("isValidApiKey", () => {
    it.each([
        "",
        "k".repeat(200),
    ])("accepts an optional API key at a valid length", (apiKey) => {
        expect(isValidApiKey(apiKey)).toBe(true);
    });

    it("rejects an API key longer than 200 characters", () => {
        expect(isValidApiKey("k".repeat(201))).toBe(false);
    });

    it.each([
        " key",
        "key ",
    ])("rejects surrounding whitespace in %j", (apiKey) => {
        expect(isValidApiKey(apiKey)).toBe(false);
    });
});

describe("isValidModel", () => {
    it("accepts a non-empty model name at the length limit", () => {
        expect(isValidModel("m".repeat(200))).toBe(true);
    });

    it("rejects an empty model name", () => {
        expect(isValidModel("")).toBe(false);
    });

    it("rejects a model name longer than 200 characters", () => {
        expect(isValidModel("m".repeat(201))).toBe(false);
    });

    it.each([
        " model",
        "model ",
    ])("rejects surrounding whitespace in %j", (model) => {
        expect(isValidModel(model)).toBe(false);
    });
});
