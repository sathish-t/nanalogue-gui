// Tests for buildSandboxPrompt, renderFactsBlock, and system prompt assembly.
// Verifies that all external function docs, dynamic limits, facts JSON,
// and SYSTEM_APPEND assembly are correctly reflected in the system prompt.

import { describe, expect, it } from "vitest";
import { EXTERNAL_FUNCTIONS } from "./ai-chat-constants";
import type { AiChatConfig, Fact } from "./chat-types";
import {
    buildSandboxPrompt,
    buildSystemPromptParts,
    joinSystemPromptParts,
    renderFactsBlock,
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
// renderFactsBlock
// ---------------------------------------------------------------------------

describe("renderFactsBlock", () => {
    it("returns empty string for an empty facts array", () => {
        expect(renderFactsBlock([])).toBe("");
    });

    it("produces a JSON fenced block containing the fact type", () => {
        const fact: Fact = {
            type: "file",
            filename: "sample.bam",
            roundId: "r1",
            timestamp: 1_700_000_000_000,
        };
        const block = renderFactsBlock([fact]);
        const match = /```json\n([\s\S]*?)\n```/.exec(block);
        expect(match, "expected a ```json fenced block").not.toBeNull();
        const parsed = JSON.parse(match?.[1] ?? "") as unknown[];
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(1);
        const entry = parsed[0] as Record<string, unknown>;
        expect(entry.type).toBe("file");
        expect(entry.filename).toBe("sample.bam");
    });

    it("strips timestamp from the serialised output", () => {
        const fact: Fact = {
            type: "filter",
            description: "primary only",
            roundId: "r2",
            timestamp: 1_700_000_000_001,
        };
        const block = renderFactsBlock([fact]);
        expect(block).not.toContain("timestamp");
        expect(block).toContain("primary only");
    });

    it("strips roundId from the serialised output", () => {
        const fact: Fact = {
            type: "file",
            filename: "reads.bam",
            roundId: "round-xyz",
            timestamp: 1,
        };
        const block = renderFactsBlock([fact]);
        expect(block).not.toContain("roundId");
        expect(block).not.toContain("round-xyz");
    });

    it("includes all facts in a mixed array and the JSON is valid", () => {
        const facts: Fact[] = [
            { type: "file", filename: "a.bam", roundId: "r1", timestamp: 1 },
            {
                type: "filter",
                description: "q>20",
                roundId: "r2",
                timestamp: 2,
            },
        ];
        const block = renderFactsBlock(facts);
        const match = /```json\n([\s\S]*?)\n```/.exec(block);
        expect(match).not.toBeNull();
        const parsed = JSON.parse(match?.[1] ?? "") as unknown[];
        expect(parsed).toHaveLength(2);
    });

    it("preserves fact content fields in the output", () => {
        const fact: Fact = {
            type: "filter",
            description: "min_seq_len=5000",
            roundId: "r3",
            timestamp: 42,
        };
        const block = renderFactsBlock([fact]);
        expect(block).toContain("min_seq_len=5000");
    });

    it("includes a 'Conversation facts' heading in the block", () => {
        const fact: Fact = {
            type: "file",
            filename: "data.bam",
            roundId: "r1",
            timestamp: 0,
        };
        const block = renderFactsBlock([fact]);
        expect(block).toContain("Conversation facts");
    });
});

// ---------------------------------------------------------------------------
// System prompt assembly — base/append/facts block handling
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

    it("returns non-overlapping base, append, and facts parts", () => {
        const parts = buildSystemPromptParts({
            config,
            facts: [
                {
                    type: "file",
                    filename: "reads.bam",
                    roundId: "r1",
                    timestamp: 1,
                },
            ],
            appendSystemPrompt:
                "## Domain context\nFocus on CpG methylation only.",
            replaceSystemPrompt: "## Replacement base\nCustom instructions.",
        });

        expect(parts.base).toBe("## Replacement base\nCustom instructions.");
        expect(parts.append).toBe(
            "## Domain context\nFocus on CpG methylation only.",
        );
        expect(parts.facts).toContain("Conversation facts");
        expect(parts.facts).toContain("reads.bam");
    });

    it("builds the default sandbox prompt in the base part when no replacement is provided", () => {
        const parts = buildSystemPromptParts({
            config,
            facts: [],
        });

        expect(parts.base).toContain(
            "You are a Python REPL for bioinformatics analysis.",
        );
        expect(parts.append).toBe("");
        expect(parts.facts).toBe("");
    });

    it("joins non-empty parts with exactly two newlines", () => {
        const result = joinSystemPromptParts({
            base: "## System\nDo genomics analysis.",
            append: "## Domain context\nFocus on CpG methylation only.",
            facts: "## Facts\n```json\n[]\n```",
        });
        expect(result).toBe(
            "## System\nDo genomics analysis.\n\n## Domain context\nFocus on CpG methylation only.\n\n## Facts\n```json\n[]\n```",
        );
    });

    it("skips empty parts when joining", () => {
        expect(
            joinSystemPromptParts({ base: "## System", facts: "## Facts" }),
        ).toBe("## System\n\n## Facts");
    });
});
