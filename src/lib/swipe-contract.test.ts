import { describe, expect, it } from "vitest";
import {
    type SwipeStartRequest,
    validateSwipeStartRequest,
} from "./swipe-contract";

/** Valid Swipe start request used by validator tests. */
const VALID_REQUEST: SwipeStartRequest = {
    bamPath: "/data/sample.bam",
    bedPath: "/data/annotations.bed",
    outputPath: "/data/accepted.bed",
    windowSize: 200,
};

describe("validateSwipeStartRequest", () => {
    it("returns the validated request without unknown properties", () => {
        expect(
            validateSwipeStartRequest({
                ...VALID_REQUEST,
                regionExpansion: 100,
                treatAsUrl: false,
                unexpected: "discarded",
            }),
        ).toEqual({
            ...VALID_REQUEST,
            modTag: undefined,
            modStrand: undefined,
            regionExpansion: 100,
            showAnnotationHighlight: undefined,
            treatAsUrl: false,
        });
    });

    it.each([
        [null, "expected an object"],
        [{ ...VALID_REQUEST, bamPath: "" }, "bamPath"],
        [{ ...VALID_REQUEST, windowSize: 0 }, "windowSize"],
        [{ ...VALID_REQUEST, windowSize: 10_001 }, "windowSize"],
        [{ ...VALID_REQUEST, modTag: 42 }, "modTag"],
        [{ ...VALID_REQUEST, modStrand: "invalid" }, "modStrand"],
        [{ ...VALID_REQUEST, regionExpansion: -1 }, "regionExpansion"],
        [{ ...VALID_REQUEST, treatAsUrl: "false" }, "treatAsUrl"],
        [
            { ...VALID_REQUEST, bamPath: "/local.bam", treatAsUrl: true },
            "BAM URL",
        ],
    ])("rejects invalid payload %#", (payload, message) => {
        expect(() => validateSwipeStartRequest(payload)).toThrow(message);
    });
});
