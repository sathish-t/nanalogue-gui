// Tests for strict CLI option and removed-tool parsing.

import { describe, expect, it } from "vitest";
import {
    findDuplicateCliOption,
    parseRemovedToolNames,
} from "./cli-user-input-parsing";

describe("findDuplicateCliOption", () => {
    it("returns the repeated canonical option name", () => {
        expect(
            findDuplicateCliOption([
                { kind: "option", name: "dir" },
                { kind: "positional" },
                { kind: "option", name: "dir" },
            ]),
        ).toBe("dir");
    });

    it("returns null when each option appears once", () => {
        expect(
            findDuplicateCliOption([
                { kind: "option", name: "dir" },
                { kind: "option", name: "help" },
            ]),
        ).toBeNull();
    });
});

describe("parseRemovedToolNames", () => {
    const validTools = ["read_info", "bam_mods", "ls"];

    it("accepts unique known comma-separated tools", () => {
        expect(parseRemovedToolNames("read_info,ls", validTools)).toEqual({
            valid: true,
            names: ["read_info", "ls"],
        });
    });

    it.each([
        ["", "cannot be empty"],
        ["read_info,,ls", "empty entry"],
        ["read_info, ls", "surrounding whitespace"],
        ["x".repeat(301), "exceeds 300 characters"],
        ["unknown", "unknown tool"],
        ["ls,ls", "repeats tool"],
    ])("rejects malformed list %j", (rawValue, expectedError) => {
        const result = parseRemovedToolNames(rawValue, validTools);
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain(expectedError);
    });
});
