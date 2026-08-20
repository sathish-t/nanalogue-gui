import { describe, expect, it } from "vitest";
import { validateQCRequest } from "./qc-contract";
import type { QCConfig } from "./types";

/** Valid QC request used by contract tests. */
const VALID_REQUEST: QCConfig = {
    bamPath: "/data/sample.bam",
    treatAsUrl: false,
    sampleFraction: 5,
    sampleSeed: 42,
    windowSize: 300,
    readLengthBinWidth: 100,
    fullRegion: undefined,
};

describe("validateQCRequest", () => {
    it("returns a canonical request without unknown or renderer-owned fields", () => {
        expect(
            validateQCRequest({
                ...VALID_REQUEST,
                mapqFilter: 30,
                readIdSet: ["renderer-controlled"],
                unexpected: "discarded",
            }),
        ).toEqual({
            ...VALID_REQUEST,
            tag: undefined,
            modStrand: undefined,
            region: undefined,
            modRegion: undefined,
            mapqFilter: 30,
            excludeMapqUnavail: undefined,
            readFilter: undefined,
            minSeqLen: undefined,
            minAlignLen: undefined,
            readIdFilePath: undefined,
            baseQualFilterMod: undefined,
            trimReadEndsMod: undefined,
            rejectModQualNonInclusive: undefined,
        });
    });

    it("accepts all supported optional fields", () => {
        expect(
            validateQCRequest({
                ...VALID_REQUEST,
                tag: "m",
                modStrand: "bc",
                region: "chr1:1-100",
                modRegion: "chr1:20-80",
                fullRegion: true,
                excludeMapqUnavail: true,
                readFilter: "primary_forward",
                readIdFilePath: "/data/read-ids.txt",
                rejectModQualNonInclusive: [50, 200],
            }),
        ).toMatchObject({
            tag: "m",
            modStrand: "bc",
            region: "chr1:1-100",
            modRegion: "chr1:20-80",
            fullRegion: true,
            excludeMapqUnavail: true,
            readFilter: "primary_forward",
            readIdFilePath: "/data/read-ids.txt",
            rejectModQualNonInclusive: [50, 200],
        });
    });

    it("accepts inclusive numeric boundary values", () => {
        expect(
            validateQCRequest({
                ...VALID_REQUEST,
                sampleFraction: 0.01,
                sampleSeed: 4_294_967_295,
                windowSize: 10_000,
                readLengthBinWidth: 1,
                mapqFilter: 255,
                minSeqLen: 0,
                minAlignLen: 0,
                baseQualFilterMod: 93,
                trimReadEndsMod: 0,
                rejectModQualNonInclusive: [0, 255],
            }),
        ).toMatchObject({
            sampleFraction: 0.01,
            sampleSeed: 4_294_967_295,
            windowSize: 10_000,
            readLengthBinWidth: 1,
            mapqFilter: 255,
            minSeqLen: 0,
            minAlignLen: 0,
            baseQualFilterMod: 93,
            trimReadEndsMod: 0,
            rejectModQualNonInclusive: [0, 255],
        });
    });

    it.each([
        [null, "expected an object"],
        [[], "expected an object"],
        [{ ...VALID_REQUEST, bamPath: "" }, "bamPath"],
        [{ ...VALID_REQUEST, treatAsUrl: "false" }, "treatAsUrl"],
        [{ ...VALID_REQUEST, tag: null }, "tag"],
        [{ ...VALID_REQUEST, modStrand: "invalid" }, "modStrand"],
        [{ ...VALID_REQUEST, region: 42 }, "region"],
        [{ ...VALID_REQUEST, fullRegion: true }, "fullRegion requires region"],
        [
            { ...VALID_REQUEST, modRegion: "chr1:1-2" },
            "modRegion requires region",
        ],
        [{ ...VALID_REQUEST, excludeMapqUnavail: 1 }, "excludeMapqUnavail"],
        [{ ...VALID_REQUEST, readFilter: "" }, "readFilter"],
        [{ ...VALID_REQUEST, readIdFilePath: null }, "readIdFilePath"],
        [
            {
                ...VALID_REQUEST,
                bamPath: "/local/sample.bam",
                treatAsUrl: true,
            },
            "BAM URL",
        ],
    ])("rejects malformed non-numeric payload %#", (payload, message) => {
        expect(() => validateQCRequest(payload)).toThrow(message);
    });

    it.each([
        ["sampleFraction", Number.NaN, "sampleFraction"],
        ["sampleFraction", 0, "sampleFraction"],
        ["sampleFraction", 101, "sampleFraction"],
        ["sampleSeed", -1, "sampleSeed"],
        ["sampleSeed", 1.5, "sampleSeed"],
        ["sampleSeed", 4_294_967_296, "sampleSeed"],
        ["windowSize", 1, "windowSize"],
        ["windowSize", 10_001, "windowSize"],
        ["readLengthBinWidth", 1.5, "readLengthBinWidth"],
        ["readLengthBinWidth", Number.MAX_VALUE, "readLengthBinWidth"],
        ["mapqFilter", 256, "mapqFilter"],
        ["minSeqLen", -1, "minSeqLen"],
        ["minAlignLen", 1.5, "minAlignLen"],
        ["baseQualFilterMod", 94, "baseQualFilterMod"],
        ["trimReadEndsMod", -1, "trimReadEndsMod"],
    ])("rejects invalid numeric field %s", (field, value, message) => {
        expect(() =>
            validateQCRequest({ ...VALID_REQUEST, [field]: value }),
        ).toThrow(message);
    });

    it.each([
        [null, "2-element array"],
        [[50], "2-element array"],
        [[50, 200, 250], "2-element array"],
        [[-1, 200], "rejectModQualLow"],
        [[50, 256], "rejectModQualHigh"],
        [[50.5, 200], "rejectModQualLow"],
        [[200, 50], "less than"],
        [[50, 50], "less than"],
    ])("rejects invalid modification probability range %#", (range, message) => {
        expect(() =>
            validateQCRequest({
                ...VALID_REQUEST,
                rejectModQualNonInclusive: range,
            }),
        ).toThrow(message);
    });
});
