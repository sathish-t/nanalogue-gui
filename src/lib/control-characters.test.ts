import { describe, expect, it } from "vitest";
import { hasControlChars } from "./control-characters";

describe("hasControlChars", () => {
    it("returns false for a normal filename", () => {
        expect(hasControlChars("report.bam")).toBe(false);
    });

    it("returns true for a null byte", () => {
        expect(hasControlChars("bad\x00name")).toBe(true);
    });

    it("returns true for a DEL character", () => {
        expect(hasControlChars("bad\x7fname")).toBe(true);
    });

    it("returns true for a control character in the middle", () => {
        expect(hasControlChars("a\x1fb")).toBe(true);
    });
});
