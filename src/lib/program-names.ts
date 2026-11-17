// Program names of nanalogue-gui and its standalone CLIs.
// The CLI names are checked at compile time against package.json "bin";
// the GUI name is checked against package.json "build.productName" in program-names.test.ts.

/** Command names that package.json "bin" installs. */
export type CliBinName = keyof typeof import("../../package.json")["bin"];

export const /** Command name of the AI chat CLI, as installed by package.json "bin". */ CHAT_CLI_PROGRAM_NAME =
        "nanalogue-chat" satisfies CliBinName;

export const /** Command name of the sandbox runner CLI, as installed by package.json "bin". */ SANDBOX_EXEC_CLI_PROGRAM_NAME =
        "nanalogue-sandbox-exec" satisfies CliBinName;

export const /** Product name of the Electron GUI app, matching package.json "build.productName". */ GUI_APP_PROGRAM_NAME =
        "nanalogue-gui";
