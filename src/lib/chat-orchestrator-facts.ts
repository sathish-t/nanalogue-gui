// Fact extraction and eviction helpers for AI chat orchestration.
// Keeps fact management separate from the main turn loop.

import { MAX_FACTS_BYTES } from "./ai-chat-constants";
import type { Fact, SandboxResult } from "./chat-types";
import { safeStringify } from "./monty-sandbox-helpers";

/**
 * Adds a new fact to the facts array with replace-by-key dedup.
 *
 * @param facts - The current facts array (mutated in place).
 * @param newFact - The fact to add.
 */
export function addFact(facts: Fact[], newFact: Fact): void {
    /**
     * Derives a unique dedup key from a fact based on its type.
     *
     * @param f - The fact to derive a key from.
     * @returns A string key unique to the fact's identity.
     */
    const keyOf = (f: Fact): string => {
        switch (f.type) {
            case "file":
                return `file:${f.filename}`;
            case "filter":
                return `filter:${f.roundId}`;
            case "output":
                return `output:${f.path}`;
        }
    };

    const newKey = keyOf(newFact);
    const existingIdx = facts.findIndex((f) => keyOf(f) === newKey);
    if (existingIdx >= 0) {
        facts[existingIdx] = newFact;
    } else {
        facts.push(newFact);
    }
}

/**
 * Evicts oldest filter facts when the array exceeds MAX_FACTS_BYTES.
 * Output facts are never age-evicted.
 *
 * @param facts - The facts array to evict from (mutated in place).
 */
export function evictFacts(facts: Fact[]): void {
    const serialized = safeStringify(facts);
    const currentBytes = serialized.ok
        ? Buffer.byteLength(serialized.json, "utf-8")
        : 0;

    if (currentBytes <= MAX_FACTS_BYTES) return;

    // Evict filter facts first (oldest first), then file facts if still over budget.
    // Output facts are never evicted.
    const evictable = facts
        .map((f, i) => ({ fact: f, index: i }))
        .filter((e) => e.fact.type === "filter" || e.fact.type === "file")
        .sort((a, b) => {
            // Filters before files, then oldest first within each type
            if (a.fact.type !== b.fact.type) {
                return a.fact.type === "filter" ? -1 : 1;
            }
            return a.fact.timestamp - b.fact.timestamp;
        });

    for (const entry of evictable) {
        facts.splice(facts.indexOf(entry.fact), 1);
        const recheck = safeStringify(facts);
        const recheckBytes = recheck.ok
            ? Buffer.byteLength(recheck.json, "utf-8")
            : 0;
        if (recheckBytes <= MAX_FACTS_BYTES) break;
    }
}

/**
 * Extracts facts from a successful execution result and the code that produced it.
 *
 * @param toolResult - The sandbox result.
 * @param toolCallArgs - The parsed code arguments.
 * @param toolCallArgs.code - The Python code that was executed.
 * @param roundId - The execution round identifier.
 * @param facts - The facts array to add to (mutated in place).
 */
export function extractFacts(
    toolResult: SandboxResult,
    toolCallArgs: { /** The Python code that was executed. */ code: string },
    roundId: string,
    facts: Fact[],
): void {
    if (!toolResult.success) return;

    const now = Date.now();
    const code = toolCallArgs.code;

    // Extract file facts from peek/read_info/bam_mods calls
    const fileMatches = code.matchAll(
        /(?:peek|read_info|bam_mods|window_reads|seq_table)\s*\(\s*["']([^"']+)["']/g,
    );
    for (const match of fileMatches) {
        addFact(facts, {
            type: "file",
            filename: match[1],
            roundId,
            timestamp: now,
        });
    }

    // Extract output facts from write_file calls
    if (
        toolResult.value &&
        typeof toolResult.value === "object" &&
        "path" in (toolResult.value as Record<string, unknown>)
    ) {
        const writeResult = toolResult.value as Record<string, unknown>;
        const path = writeResult.path;
        const bytesWritten = writeResult.bytes_written;
        const hasWriteFileCall = /write_file\s*\(/.test(code);
        if (
            hasWriteFileCall &&
            typeof path === "string" &&
            path &&
            typeof bytesWritten === "number"
        ) {
            addFact(facts, {
                type: "output",
                path,
                roundId,
                timestamp: now,
            });
        }
    }

    // Extract filter facts from kwargs
    const filterParts: string[] = [];
    const regionMatch = code.match(/region\s*=\s*["']([^"']+)["']/);
    if (regionMatch) filterParts.push(`region=${regionMatch[1]}`);
    const sampleMatch = code.match(/sample_fraction\s*=\s*([\d.]+)/);
    if (sampleMatch) filterParts.push(`sample_fraction=${sampleMatch[1]}`);
    const mapqMatch = code.match(/mapq_filter\s*=\s*(\d+)/);
    if (mapqMatch) filterParts.push(`mapq>=${mapqMatch[1]}`);
    if (filterParts.length > 0) {
        addFact(facts, {
            type: "filter",
            description: filterParts.join(", "),
            roundId,
            timestamp: now,
        });
    }

    evictFacts(facts);
}
