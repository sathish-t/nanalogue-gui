// Tests for OSC 7501 program status reports from the standalone CLIs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildProgramStatusSequence,
    NO_PROGRAM_STATUS_ENV_VAR,
    reportProgramStatus,
} from "./cli-program-status";

/**
 * Extracts and decodes the base64 msg value from an OSC 7501 sequence.
 *
 * @param sequence - A complete OSC 7501 escape sequence.
 * @returns The decoded message text, or undefined when there is no msg pair.
 */
function decodeStatusMsg(sequence: string): string | undefined {
    const msgPair = sequence
        .slice(0, -"\x1b\\".length)
        .split(":")
        .find((pair) => pair.startsWith("msg="));
    return msgPair === undefined
        ? undefined
        : Buffer.from(msgPair.slice("msg=".length), "base64").toString("utf-8");
}

describe("buildProgramStatusSequence", () => {
    it("builds the exact sequence for a state without a message", () => {
        expect(buildProgramStatusSequence("nanalogue-chat", "idle")).toBe(
            "\x1b]7501;state=idle:app=nanalogue-chat\x1b\\",
        );
    });

    it("base64-encodes the message as in the spec example", () => {
        // The spec's brew example encodes "Installing updates" this way.
        expect(
            buildProgramStatusSequence(
                "nanalogue-chat",
                "working",
                "Installing updates",
            ),
        ).toBe(
            "\x1b]7501;state=working:app=nanalogue-chat:msg=SW5zdGFsbGluZyB1cGRhdGVz\x1b\\",
        );
    });

    it("replaces control characters so the message stays on one line", () => {
        const sequence = buildProgramStatusSequence(
            "nanalogue-chat",
            "error",
            "\nline one\r\n\tline two\u0085end\u007f",
        );
        expect(decodeStatusMsg(sequence)).toBe("line one line two end");
    });

    it("replaces controls up to U+001F and U+009F and keeps U+0020 and U+00A0", () => {
        const sequence = buildProgramStatusSequence(
            "nanalogue-chat",
            "error",
            "a\u001fb\u0020c\u009fd\u00a0e",
        );
        expect(decodeStatusMsg(sequence)).toBe("a b c d\u00a0e");
    });

    it("omits msg when the message is empty after cleaning", () => {
        expect(
            buildProgramStatusSequence("nanalogue-chat", "done", " \n\t "),
        ).toBe("\x1b]7501;state=done:app=nanalogue-chat\x1b\\");
    });

    it("cuts long messages to 2048 bytes without splitting a character", () => {
        // One ASCII byte then two-byte characters, so 2048 lands mid-character.
        const sequence = buildProgramStatusSequence(
            "nanalogue-chat",
            "error",
            `a${"\u00e9".repeat(1100)}`,
        );
        const decoded = decodeStatusMsg(sequence);
        expect(decoded).toBe(`a${"\u00e9".repeat(1023)}`);
        expect(Buffer.byteLength(decoded ?? "", "utf-8")).toBe(2047);
    });

    it("keeps exactly 2048 bytes of a longer ASCII message", () => {
        const sequence = buildProgramStatusSequence(
            "nanalogue-chat",
            "error",
            "a".repeat(2049),
        );
        expect(decodeStatusMsg(sequence)).toBe("a".repeat(2048));
    });
});

describe("reportProgramStatus", () => {
    /** Original stderr TTY flag restored after each test. */
    const originalIsTTY = process.stderr.isTTY;

    beforeEach(() => {
        vi.stubEnv(NO_PROGRAM_STATUS_ENV_VAR, undefined);
        process.stderr.isTTY = true;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        process.stderr.isTTY = originalIsTTY;
    });

    it("writes the sequence to stderr when stderr is a terminal", () => {
        const write = vi
            .spyOn(process.stderr, "write")
            .mockImplementation(() => true);
        reportProgramStatus("nanalogue-sandbox-exec", "done", "x.py finished");
        expect(write).toHaveBeenCalledExactlyOnceWith(
            buildProgramStatusSequence(
                "nanalogue-sandbox-exec",
                "done",
                "x.py finished",
            ),
        );
    });

    it("writes nothing when stderr is not a terminal", () => {
        process.stderr.isTTY = false;
        const write = vi
            .spyOn(process.stderr, "write")
            .mockImplementation(() => true);
        reportProgramStatus("nanalogue-chat", "working", "Thinking");
        expect(write).not.toHaveBeenCalled();
    });

    it("writes nothing when NANALOGUE_NO_PROGRAM_STATUS is set, even empty", () => {
        vi.stubEnv(NO_PROGRAM_STATUS_ENV_VAR, "");
        const write = vi
            .spyOn(process.stderr, "write")
            .mockImplementation(() => true);
        reportProgramStatus("nanalogue-chat", "working", "Thinking");
        expect(write).not.toHaveBeenCalled();
    });
});
