// Tests for buildSandboxPrompt and system prompt assembly.
// Verifies that all external function docs, dynamic limits, and
// SYSTEM_APPEND assembly are correctly reflected in the system prompt.

import { describe, expect, it } from "vitest";
import { EXTERNAL_FUNCTIONS } from "./ai-chat-constants";
import type { AiChatConfig } from "./chat-types";
import {
    buildSandboxPrompt,
    buildSystemPromptParts,
    joinSystemPromptParts,
    type SandboxPromptOptions,
} from "./sandbox-prompt";

// ---------------------------------------------------------------------------
// Shared baseline options used by most buildSandboxPrompt tests.
// ---------------------------------------------------------------------------

/** Baseline options that exercise all interpolated fields. */
const BASE_OPTIONS: SandboxPromptOptions = {
    maxOutputKB: 20,
    maxRecordsReadInfo: 200_000,
    maxRecordsBamMods: 5_000,
    maxRecordsWindowReads: 5_000,
    maxRecordsSeqTable: 5_000,
    maxReadMB: 5,
    maxWriteMB: 10,
    maxDurationSecs: 600,
};

// ---------------------------------------------------------------------------
// buildSandboxPrompt — external function docs
// ---------------------------------------------------------------------------

describe("buildSandboxPrompt — external function docs", () => {
    it("contains every name from EXTERNAL_FUNCTIONS", () => {
        const prompt = buildSandboxPrompt(BASE_OPTIONS);
        for (const fn of EXTERNAL_FUNCTIONS) {
            expect(prompt, `missing external function: ${fn}`).toContain(fn);
        }
    });

    it("documents re and json as the only allowed imports", () => {
        const prompt = buildSandboxPrompt(BASE_OPTIONS);
        expect(prompt).toContain("the Python stdlib modules re and json");
        expect(prompt).toContain("Only re and json imports are available.");
    });

    it("requires external functions to be returned as Python source text", () => {
        const prompt = buildSandboxPrompt(BASE_OPTIONS);
        expect(prompt).toContain(
            "Do not use the model API's function-calling or tool-calling channel.",
        );
        expect(prompt).toContain(
            "Write every external function call as Python source text",
        );
    });

    it("documents peek, read_info, bam_mods, window_reads, seq_table as section headings", () => {
        const prompt = buildSandboxPrompt(BASE_OPTIONS);
        const required = [
            "peek",
            "read_info",
            "bam_mods",
            "window_reads",
            "seq_table",
        ];
        for (const fn of required) {
            expect(prompt).toMatch(new RegExp(`### ${fn}\\b`));
        }
    });

    it("documents mapq in read_info and bam_mods output", () => {
        const prompt = buildSandboxPrompt(BASE_OPTIONS);
        expect(prompt.match(/"mapq": 60/g)).toHaveLength(2);
        expect(
            prompt.match(/255 means mapping quality is unavailable/g),
        ).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// buildSandboxPrompt — dynamic limits
// ---------------------------------------------------------------------------

describe("buildSandboxPrompt — dynamic limits", () => {
    it("interpolates maxOutputKB (KB) into the prompt", () => {
        const prompt = buildSandboxPrompt({ ...BASE_OPTIONS, maxOutputKB: 42 });
        expect(prompt).toContain("42 KB");
    });

    it("interpolates a different maxOutputKB without contaminating other builds", () => {
        const prompt99 = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxOutputKB: 99,
        });
        const prompt20 = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxOutputKB: 20,
        });
        expect(prompt99).toContain("99 KB");
        expect(prompt20).not.toContain("99 KB");
    });

    it("interpolates maxDurationSecs as rounded minutes", () => {
        // 600 s → 10 min, 120 s → 2 min
        const p10 = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxDurationSecs: 600,
        });
        expect(p10).toContain("10 minutes");

        const p2 = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxDurationSecs: 120,
        });
        expect(p2).toContain("2 minutes");
    });

    it("interpolates maxRecordsReadInfo with locale formatting", () => {
        const prompt = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxRecordsReadInfo: 200_000,
        });
        expect(prompt).toContain((200_000).toLocaleString());
    });

    it("interpolates maxRecordsBamMods with locale formatting", () => {
        const prompt = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxRecordsBamMods: 5_000,
        });
        expect(prompt).toContain((5_000).toLocaleString());
    });

    it("interpolates maxRecordsWindowReads with locale formatting", () => {
        const prompt = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxRecordsWindowReads: 3_000,
        });
        expect(prompt).toContain((3_000).toLocaleString());
    });

    it("interpolates maxRecordsSeqTable with locale formatting", () => {
        const prompt = buildSandboxPrompt({
            ...BASE_OPTIONS,
            maxRecordsSeqTable: 2_500,
        });
        expect(prompt).toContain((2_500).toLocaleString());
    });

    it("interpolates maxReadMB into the read_file section", () => {
        const prompt = buildSandboxPrompt({ ...BASE_OPTIONS, maxReadMB: 7 });
        expect(prompt).toContain("7 MB");
    });

    it("interpolates maxWriteMB into the write_file section", () => {
        const prompt = buildSandboxPrompt({ ...BASE_OPTIONS, maxWriteMB: 3 });
        expect(prompt).toContain("3 MB");
    });

    it("derives maxReadBytes as maxReadMB * 1024 * 1024", () => {
        // maxReadMB: 5 → 5_242_880 bytes, shown in the pagination example
        const prompt = buildSandboxPrompt({ ...BASE_OPTIONS, maxReadMB: 5 });
        expect(prompt).toContain(String(5 * 1024 * 1024));
    });
});

// ---------------------------------------------------------------------------
// System prompt assembly — base/append block handling
// ---------------------------------------------------------------------------

describe("system prompt assembly", () => {
    /** Minimal config for buildSystemPromptParts tests. */
    const config: AiChatConfig = {
        contextWindowTokens: 8192,
        maxRetries: 1,
        timeoutSeconds: 30,
        maxRecordsReadInfo: BASE_OPTIONS.maxRecordsReadInfo,
        maxRecordsBamMods: BASE_OPTIONS.maxRecordsBamMods,
        maxRecordsWindowReads: BASE_OPTIONS.maxRecordsWindowReads,
        maxRecordsSeqTable: BASE_OPTIONS.maxRecordsSeqTable,
        maxCodeRounds: 1,
        maxDurationSecs: BASE_OPTIONS.maxDurationSecs,
        maxMemoryMB: 512,
        maxAllocations: 100_000,
        maxReadMB: BASE_OPTIONS.maxReadMB,
        maxWriteMB: BASE_OPTIONS.maxWriteMB,
    };

    it("returns non-overlapping base and append parts", () => {
        const parts = buildSystemPromptParts({
            config,
            maxOutputKB: BASE_OPTIONS.maxOutputKB,
            appendSystemPrompt:
                "## Domain context\nFocus on CpG methylation only.",
            replaceSystemPrompt: "## Replacement base\nCustom instructions.",
        });

        expect(parts.base).toBe("## Replacement base\nCustom instructions.");
        expect(parts.append).toBe(
            "## Domain context\nFocus on CpG methylation only.",
        );
    });

    it("builds the default sandbox prompt in the base part when no replacement is provided", () => {
        const parts = buildSystemPromptParts({
            config,
            maxOutputKB: BASE_OPTIONS.maxOutputKB,
        });

        expect(parts.base).toContain(
            "You are a Python REPL for bioinformatics analysis.",
        );
        expect(parts.append).toBe("");
    });

    it("joins non-empty parts with exactly two newlines", () => {
        const result = joinSystemPromptParts({
            base: "## System\nDo genomics analysis.",
            append: "## Domain context\nFocus on CpG methylation only.",
        });
        expect(result).toBe(
            "## System\nDo genomics analysis.\n\n## Domain context\nFocus on CpG methylation only.",
        );
    });

    it("skips empty parts when joining", () => {
        expect(joinSystemPromptParts({ base: "## System", append: "" })).toBe(
            "## System",
        );
    });
});
