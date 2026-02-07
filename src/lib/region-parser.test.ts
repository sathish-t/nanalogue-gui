// Tests for parseRegion — validates genomic region strings against known contigs.

import { describe, expect, it } from "vitest";
import { parseRegion } from "./region-parser";

/** Sample contig map for testing. */
const contigs: Record<string, number> = {
    chr1: 248956422,
    chr3: 198295559,
    chrI: 230218,
    "chr1:1": 5000,
};

describe("parseRegion", () => {
    describe("bare contig names", () => {
        it("accepts a known contig name", () => {
            const result = parseRegion("chr3", contigs);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.contig).toBe("chr3");
                expect(result.start).toBeUndefined();
                expect(result.end).toBeUndefined();
            }
        });

        it("trims whitespace", () => {
            const result = parseRegion("  chr3  ", contigs);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.contig).toBe("chr3");
            }
        });

        it("rejects an unknown contig name", () => {
            const result = parseRegion("chrZ", contigs);
            expect(result.valid).toBe(false);
        });

        it("rejects an empty string", () => {
            const result = parseRegion("", contigs);
            expect(result.valid).toBe(false);
        });

        it("rejects whitespace-only input", () => {
            const result = parseRegion("   ", contigs);
            expect(result.valid).toBe(false);
        });
    });

    describe("range regions (contig:START-END)", () => {
        it("accepts a valid range", () => {
            const result = parseRegion("chrI:1000-50000", contigs);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.contig).toBe("chrI");
                expect(result.start).toBe(1000);
                expect(result.end).toBe(50000);
            }
        });

        it("accepts a range spanning the full contig", () => {
            const result = parseRegion("chrI:1-230218", contigs);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.contig).toBe("chrI");
                expect(result.start).toBe(1);
                expect(result.end).toBe(230218);
            }
        });

        it("rejects end position beyond contig length", () => {
            const result = parseRegion("chrI:1-999999", contigs);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).toContain("exceeds");
            }
        });

        it("rejects start >= end (reversed range)", () => {
            const result = parseRegion("chrI:5000-1000", contigs);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).toContain("less than");
            }
        });

        it("rejects start equal to end (zero-width range)", () => {
            const result = parseRegion("chrI:1000-1000", contigs);
            expect(result.valid).toBe(false);
        });

        it("rejects start of 0", () => {
            const result = parseRegion("chrI:0-1000", contigs);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).toContain("at least 1");
            }
        });

        it("rejects an unknown prefix with range suffix", () => {
            const result = parseRegion("chrZ:1000-2000", contigs);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).toContain("Unknown");
            }
        });
    });

    describe("single-position regions (contig:NUM)", () => {
        it("rejects single-position when prefix is a known contig", () => {
            const result = parseRegion("chr3:4000", contigs);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).toContain("Single-position");
            }
        });

        it("rejects single-position with unknown prefix", () => {
            const result = parseRegion("chrZ:4000", contigs);
            expect(result.valid).toBe(false);
        });
    });

    describe("ambiguous representations", () => {
        it("rejects when both prefix and full string are known contigs (range)", () => {
            // "chr1" is known and "chr1:1" is known — with suffix "1" (single number)
            const result = parseRegion("chr1:1", contigs);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).toContain("Ambiguous");
            }
        });
    });

    describe("non-numeric suffixes after colon", () => {
        it("falls through to full-string lookup when suffix is not numeric", () => {
            // "chr1:1" is a known contig; suffix "1" after rightmost colon would be "1"
            // but let's test with a truly non-numeric suffix
            const contigsWithWeird = { ...contigs, "foo:bar": 1000 };
            const result = parseRegion("foo:bar", contigsWithWeird);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.contig).toBe("foo:bar");
            }
        });

        it("rejects when full string with non-numeric suffix is unknown", () => {
            const result = parseRegion("chr3:abc", contigs);
            expect(result.valid).toBe(false);
        });
    });

    describe("contigs with colons in their names", () => {
        it("uses rightmost colon for splitting", () => {
            // A contig named "ns:chr1" with a range
            const contigsWithNs = { ...contigs, "ns:chr1": 50000 };
            const result = parseRegion("ns:chr1:100-200", contigsWithNs);
            expect(result.valid).toBe(true);
            if (result.valid) {
                expect(result.contig).toBe("ns:chr1");
                expect(result.start).toBe(100);
                expect(result.end).toBe(200);
            }
        });
    });
});
