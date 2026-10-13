// Tests for browser-safe strict chat user-input parsing.

import { describe, expect, it } from "vitest";
import {
    getUtf8ByteLength,
    parseCanonicalInteger,
    parseCanonicalTemperature,
} from "./chat-user-input-parsing";

describe("parseCanonicalInteger", () => {
    const range = { min: 1, max: 10 };

    it.each([
        ["1", 1],
        ["10", 10],
        ["01", 1],
    ])("accepts canonical integer %s", (rawValue, expected) => {
        expect(parseCanonicalInteger("count", rawValue, range)).toEqual({
            valid: true,
            value: expected,
        });
    });

    it.each([
        "",
        "+1",
        "-1",
        "1.0",
    ])("rejects non-canonical syntax %j", (rawValue) => {
        expect(parseCanonicalInteger("count", rawValue, range).valid).toBe(
            false,
        );
    });

    it.each(["0", "11"])("rejects out-of-range integer %s", (rawValue) => {
        expect(parseCanonicalInteger("count", rawValue, range).valid).toBe(
            false,
        );
    });

    it("rejects an unsafe integer within the input length limit", () => {
        expect(
            parseCanonicalInteger("count", "9999999999999999999", range),
        ).toEqual({ valid: false, error: "count is too large" });
    });

    it.each([
        "12345678901234567890",
        "letters",
        " 1",
        "1 ",
        "1e1",
        "0x1",
    ])("rejects malformed integer input shape %j", (rawValue) => {
        expect(parseCanonicalInteger("count", rawValue, range).valid).toBe(
            false,
        );
    });
});

describe("parseCanonicalTemperature", () => {
    it.each([
        ["", undefined],
        ["0", 0],
        ["0.5", 0.5],
        ["2", 2],
        ["2.0", 2],
    ])("accepts temperature %j", (rawValue, expected) => {
        expect(parseCanonicalTemperature("temperature", rawValue)).toEqual({
            valid: true,
            value: expected,
        });
    });

    it.each([
        "+1",
        "-0.1",
        ".5",
        "1.",
        "2.1",
    ])("rejects malformed temperature %j", (rawValue) => {
        expect(parseCanonicalTemperature("temperature", rawValue).valid).toBe(
            false,
        );
    });

    it.each([
        "1234567890",
        "1e0",
        " 1",
        "1 ",
    ])("rejects malformed temperature input shape %j", (rawValue) => {
        expect(parseCanonicalTemperature("temperature", rawValue).valid).toBe(
            false,
        );
    });
});

describe("getUtf8ByteLength", () => {
    it("counts UTF-8 bytes rather than UTF-16 code units", () => {
        expect(getUtf8ByteLength("A\u00e9\u{1f9ec}")).toBe(7);
    });
});
