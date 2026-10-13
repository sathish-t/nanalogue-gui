/**
 * Checks whether a string contains ASCII control characters (0x00-0x1F or 0x7F).
 *
 * @param value - The string to check.
 * @returns True if the string contains control characters.
 */
export function hasControlChars(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
            return true;
        }
    }
    return false;
}
