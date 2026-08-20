import { describe, expect, it } from "vitest";
import { buildQCConfig, type QCConfigInputSnapshot } from "./qc-config-builder";

/**
 * Creates a valid minimal form snapshot with optional controls unset.
 *
 * @param overrides - Snapshot fields to replace.
 * @returns A valid input snapshot.
 */
function minimalInput(
    overrides: Partial<QCConfigInputSnapshot> = {},
): QCConfigInputSnapshot {
    return {
        bamPath: "/data/sample.bam",
        treatAsUrl: false,
        tag: "m",
        modStrand: "bc",
        sampleFraction: "5",
        sampleSeed: "42",
        windowSize: 300,
        readLengthBinWidth: "1000",
        region: "",
        modRegion: "",
        fullRegion: false,
        contigs: { chr1: 10_000, chr2: 20_000 },
        mapqFilter: undefined,
        excludeMapqUnavail: false,
        readFilter: undefined,
        minSeqLen: undefined,
        minAlignLen: undefined,
        readIdFilePath: "",
        baseQualFilterMod: undefined,
        trimReadEndsMod: undefined,
        modProbLow: undefined,
        modProbHigh: undefined,
        ...overrides,
    };
}

/**
 * Returns the failure message for a snapshot expected to be invalid.
 *
 * @param input - Snapshot expected to fail validation.
 * @returns The builder's user-facing failure message.
 */
function failureMessage(input: QCConfigInputSnapshot): string {
    const result = buildQCConfig(input);
    expect(result.success).toBe(false);
    return result.success ? "" : result.message;
}

describe("buildQCConfig", () => {
    it("builds the canonical minimal config", () => {
        expect(buildQCConfig(minimalInput())).toEqual({
            success: true,
            config: {
                bamPath: "/data/sample.bam",
                treatAsUrl: false,
                tag: "m",
                modStrand: "bc",
                region: undefined,
                modRegion: undefined,
                fullRegion: undefined,
                sampleFraction: 5,
                sampleSeed: 42,
                windowSize: 300,
                readLengthBinWidth: 1000,
                mapqFilter: undefined,
                excludeMapqUnavail: undefined,
                readFilter: undefined,
                minSeqLen: undefined,
                minAlignLen: undefined,
                readIdFilePath: undefined,
                baseQualFilterMod: undefined,
                trimReadEndsMod: undefined,
                rejectModQualNonInclusive: undefined,
            },
        });
    });

    it("builds a full config with region, probability, and read filters", () => {
        const result = buildQCConfig(
            minimalInput({
                treatAsUrl: true,
                region: " chr1:100-500 ",
                modRegion: "chr1:200-300",
                fullRegion: true,
                mapqFilter: 20,
                excludeMapqUnavail: true,
                readFilter: "primary_forward,supplementary",
                minSeqLen: 1000,
                minAlignLen: 900,
                readIdFilePath: " /data/ids.txt ",
                baseQualFilterMod: 12,
                trimReadEndsMod: 10,
                modProbLow: 50,
                modProbHigh: 200,
            }),
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.config).toMatchObject({
                treatAsUrl: true,
                region: "chr1:100-500",
                modRegion: "chr1:200-300",
                fullRegion: true,
                mapqFilter: 20,
                excludeMapqUnavail: true,
                readFilter: "primary_forward,supplementary",
                minSeqLen: 1000,
                minAlignLen: 900,
                readIdFilePath: "/data/ids.txt",
                baseQualFilterMod: 12,
                trimReadEndsMod: 10,
                rejectModQualNonInclusive: [50, 200],
            });
        }
    });

    it.each([
        "",
        "0",
        "100.01",
    ])("rejects invalid sample fraction %j", (sampleFraction) => {
        expect(failureMessage(minimalInput({ sampleFraction }))).toBe(
            "Sample fraction must be a number between 0.01 and 100.",
        );
    });

    it.each(["", "-1"])("rejects invalid seed %j", (sampleSeed) => {
        expect(failureMessage(minimalInput({ sampleSeed }))).toBe(
            "Sample seed must be a non-negative integer.",
        );
    });

    it("rejects an invalid window size", () => {
        expect(failureMessage(minimalInput({ windowSize: 1 }))).toBe(
            "Window size must be an integer between 2 and 10,000.",
        );
    });

    it("rejects a non-finite probability bound", () => {
        expect(
            failureMessage(
                minimalInput({ modProbLow: Number.NaN, modProbHigh: 100 }),
            ),
        ).toBe(
            "Mod probability filter: low bound must be less than high bound.",
        );
    });

    it.each([
        "0",
        "invalid",
    ])("rejects invalid read length granularity %j", (readLengthBinWidth) => {
        expect(failureMessage(minimalInput({ readLengthBinWidth }))).toBe(
            "Read length granularity must be a positive integer.",
        );
    });

    it("reports invalid region syntax", () => {
        expect(failureMessage(minimalInput({ region: "chr1:100" }))).toBe(
            'Invalid region: Single-position regions like "chr1:100" are not supported. Use a range like chr1:START-END.',
        );
    });

    it("requires a main region before a mod region", () => {
        expect(failureMessage(minimalInput({ modRegion: "chr1" }))).toBe(
            "Mod region requires a region to be set.",
        );
    });

    it("reports invalid mod region syntax", () => {
        expect(
            failureMessage(
                minimalInput({ region: "chr1", modRegion: "missing" }),
            ),
        ).toBe('Invalid mod region: Unknown reference sequence: "missing".');
    });

    it("rejects a mod region that does not overlap the main region", () => {
        expect(
            failureMessage(
                minimalInput({
                    region: "chr1:100-200",
                    modRegion: "chr1:300-400",
                }),
            ),
        ).toBe(
            "Mod region chr1:300-400 does not overlap with region chr1:100-200.",
        );
    });

    it("requires both probability bounds", () => {
        expect(failureMessage(minimalInput({ modProbLow: 10 }))).toBe(
            "Mod probability filter requires both low and high bounds.",
        );
    });

    it("requires probability bounds in ascending order", () => {
        expect(
            failureMessage(minimalInput({ modProbLow: 100, modProbHigh: 100 })),
        ).toBe(
            "Mod probability filter: low bound must be less than high bound.",
        );
    });
});
