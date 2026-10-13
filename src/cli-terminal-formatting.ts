// Shared ANSI formatting constants for the standalone nanalogue-chat CLI.

export const /** Resets all terminal ANSI formatting. */ TERMINAL_RESET =
        "\x1b[0m";

export const /** Applies bold terminal text formatting. */ TERMINAL_BOLD =
        "\x1b[1m";

export const /** Applies dim terminal text formatting. */ TERMINAL_DIM =
        "\x1b[2m";

export const /** Applies red terminal text formatting. */ TERMINAL_RED =
        "\x1b[31m";

export const /** Applies yellow terminal text formatting. */ TERMINAL_YELLOW =
        "\x1b[33m";

export const /** Applies light blue terminal text formatting. */ TERMINAL_LIGHT_BLUE =
        "\x1b[94m";

export const /** Returns the terminal cursor to column zero and clears the current line. */ TERMINAL_CLEAR_LINE =
        "\r\x1b[K";
