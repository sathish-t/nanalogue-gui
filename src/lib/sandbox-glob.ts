// Restricted glob matching for sandbox file discovery; no expansion or backtracking.

import { SandboxError } from "./monty-sandbox-helpers";

/** Maximum glob pattern length in UTF-16 code units, checked before parsing. */
const MAX_SANDBOX_GLOB_LENGTH = 1024;

/**
 * Matches one path segment using iterative wildcard dynamic programming.
 * A question mark consumes one Unicode code point, not one UTF-16 code unit.
 *
 * @param pattern - Parsed literal, star, and question-mark tokens.
 * @param segment - One filename or directory name, without separators.
 * @returns Whether the entire segment matches, respecting explicit leading dots.
 */
function matchesSandboxGlobSegment(
    pattern: string[],
    segment: string,
): boolean {
    if (segment.startsWith(".") && pattern[0] !== ".") {
        return false;
    }
    const characters = Array.from(segment);
    const matched = new Array<boolean>(characters.length + 1).fill(false);
    matched[0] = true;
    for (const token of pattern) {
        let diagonal = matched[0];
        matched[0] = token === "*" && matched[0];
        for (let index = 1; index <= characters.length; index += 1) {
            const previous = matched[index];
            matched[index] =
                token === "*"
                    ? previous || matched[index - 1]
                    : diagonal &&
                      (token === "?" || token === characters[index - 1]);
            diagonal = previous;
        }
    }
    return matched[characters.length];
}

/**
 * Compiles a restricted sandbox glob once per ls call. Accepts relative paths,
 * stars and question marks within segments, and globstars as complete segments.
 * Matching is case-sensitive on every OS; hidden segments need a leading dot.
 * Unsupported syntax throws ValueError before any directory traversal.
 * Iterative matching costs O(pattern length × path length), with O(path length)
 * working memory; it never expands alternatives or backtracks recursively.
 *
 * @param pattern - Nonempty slash-separated pattern, at most 1024 UTF-16 units.
 * @returns A predicate for normalized, nonempty relative file paths.
 */
export function compileSandboxGlob(
    pattern: string,
): (filePath: string) => boolean {
    if (pattern.length > MAX_SANDBOX_GLOB_LENGTH) {
        throw new SandboxError(
            "ValueError",
            `ls() glob pattern exceeds ${MAX_SANDBOX_GLOB_LENGTH} UTF-16 code units.`,
        );
    }
    const segments = pattern.split("/");
    if (
        /[{}[\]\\!]|[?*+@]\(/.test(pattern) ||
        segments.some(
            (segment) =>
                segment === "" ||
                segment === "." ||
                segment === ".." ||
                (segment.includes("**") && segment !== "**"),
        )
    ) {
        throw new SandboxError(
            "ValueError",
            "ls() unsupported glob pattern. Use relative paths with / separators, " +
                "* and ? within names, and ** only as a whole segment. " +
                "Braces, brackets, negation, extglobs, backslash escapes, " +
                "and empty, . or .. segments are not supported.",
        );
    }
    const tokens = segments.map((segment) => Array.from(segment));

    /**
     * Matches a complete relative file path without expanding globstar choices.
     *
     * @param filePath - Nonempty relative file path with forward slashes.
     * @returns Whether every path segment is consumed by the pattern.
     */
    return (filePath: string): boolean => {
        const pathSegments = filePath.split("/");
        let matched = new Array<boolean>(pathSegments.length + 1).fill(false);
        matched[0] = true;
        for (let index = 0; index < segments.length; index += 1) {
            const globstar = segments[index] === "**";
            const next = new Array<boolean>(pathSegments.length + 1).fill(
                false,
            );
            next[0] = globstar && matched[0];
            for (
                let pathIndex = 1;
                pathIndex <= pathSegments.length;
                pathIndex += 1
            ) {
                const segment = pathSegments[pathIndex - 1];
                next[pathIndex] = globstar
                    ? matched[pathIndex] ||
                      (next[pathIndex - 1] && !segment.startsWith("."))
                    : matched[pathIndex - 1] &&
                      matchesSandboxGlobSegment(tokens[index], segment);
            }
            matched = next;
        }
        return matched[pathSegments.length];
    };
}
