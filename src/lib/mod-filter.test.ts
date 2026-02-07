// Tests for the modification filter parser.

import { describe, expect, it } from "vitest";
import { parseModFilter } from "./mod-filter";

describe("parseModFilter", () => {
    it("returns empty result for empty string", () => {
        expect(parseModFilter("")).toEqual({});
    });

    it("returns empty result for whitespace-only string", () => {
        expect(parseModFilter("   ")).toEqual({});
    });

    it("parses +T as basecalled strand with tag T", () => {
        expect(parseModFilter("+T")).toEqual({ tag: "T", modStrand: "bc" });
    });

    it("parses -m as complementary strand with tag m", () => {
        expect(parseModFilter("-m")).toEqual({
            tag: "m",
            modStrand: "bc_comp",
        });
    });

    it("parses +a as basecalled strand with tag a", () => {
        expect(parseModFilter("+a")).toEqual({ tag: "a", modStrand: "bc" });
    });

    it("returns empty result for bare +", () => {
        expect(parseModFilter("+")).toEqual({});
    });

    it("returns empty result for bare -", () => {
        expect(parseModFilter("-")).toEqual({});
    });

    it("trims leading and trailing whitespace from overall input", () => {
        expect(parseModFilter("  +m  ")).toEqual({
            tag: "m",
            modStrand: "bc",
        });
    });

    it("trims whitespace from the tag portion", () => {
        expect(parseModFilter("+ T")).toEqual({ tag: "T", modStrand: "bc" });
    });

    it("returns empty result for sign followed by only whitespace", () => {
        expect(parseModFilter("+   ")).toEqual({});
    });

    it("returns empty result for bare tag without sign prefix", () => {
        expect(parseModFilter("m")).toEqual({});
    });

    it("parses multi-character tag with sign", () => {
        expect(parseModFilter("+5mC")).toEqual({
            tag: "5mC",
            modStrand: "bc",
        });
    });

    it("returns empty result for bare multi-character tag without sign", () => {
        expect(parseModFilter("5mC")).toEqual({});
    });
});
