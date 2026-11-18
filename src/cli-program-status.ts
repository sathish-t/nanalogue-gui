// Program status reports (OSC 7501) for the standalone nanalogue CLIs.
// Spec: https://www.superlogical.com/rex/docs/build/program-status

import type { CliBinName } from "./lib/program-names";

/** Program status state names from the OSC 7501 Program Status Protocol. */
export type ProgramStatusState =
    | "idle"
    | "working"
    | "done"
    | "error"
    | "clear";

export const /** Environment variable that turns off OSC 7501 program status reports. */ NO_PROGRAM_STATUS_ENV_VAR =
        "NANALOGUE_NO_PROGRAM_STATUS";

/** Maximum decoded UTF-8 byte length of an OSC 7501 msg value. */
const MAX_PROGRAM_STATUS_MSG_BYTES = 2048;

/**
 * Replaces each run of C0, DEL, and C1 control characters with one space,
 * since OSC 7501 msg text must be a single line without control characters.
 *
 * @param text - The message text to clean.
 * @returns The text with control character runs replaced by single spaces.
 */
function replaceStatusControlCharacters(text: string): string {
    let cleaned = "";
    let inControlRun = false;
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
            if (!inControlRun) cleaned += " ";
            inControlRun = true;
        } else {
            cleaned += character;
            inControlRun = false;
        }
    }
    return cleaned;
}

/**
 * Builds the OSC 7501 program status escape sequence for one root record report.
 *
 * Control characters in the message are replaced with spaces, and the message
 * is cut on a character boundary to the protocol's 2048-byte limit.
 *
 * @param app - Command name of the reporting CLI, such as "nanalogue-chat".
 * @param state - The program status state to report.
 * @param msg - Optional single human-readable line describing the state.
 * @returns The complete escape sequence, terminated with ESC backslash.
 */
export function buildProgramStatusSequence(
    app: CliBinName,
    state: ProgramStatusState,
    msg?: string,
): string {
    let body = `state=${state}:app=${app}`;
    const cleanMsg = replaceStatusControlCharacters(msg ?? "").trim();
    if (cleanMsg !== "") {
        let msgBytes = 0;
        let fittedMsg = "";
        for (const character of cleanMsg) {
            msgBytes += Buffer.byteLength(character, "utf-8");
            if (msgBytes > MAX_PROGRAM_STATUS_MSG_BYTES) break;
            fittedMsg += character;
        }
        body += `:msg=${Buffer.from(fittedMsg, "utf-8").toString("base64")}`;
    }
    return `\x1b]7501;${body}\x1b\\`;
}

/**
 * Reports the program status to the terminal with an OSC 7501 sequence on stderr.
 *
 * Writes nothing when stderr is not a terminal, so piped and redirected
 * output stays clean, or when NANALOGUE_NO_PROGRAM_STATUS is set.
 *
 * @param app - Command name of the reporting CLI, such as "nanalogue-chat".
 * @param state - The program status state to report.
 * @param msg - Optional single human-readable line describing the state.
 */
export function reportProgramStatus(
    app: CliBinName,
    state: ProgramStatusState,
    msg?: string,
): void {
    if (!process.stderr.isTTY || NO_PROGRAM_STATUS_ENV_VAR in process.env) {
        return;
    }
    process.stderr.write(buildProgramStatusSequence(app, state, msg));
}
