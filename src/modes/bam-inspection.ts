// Shared BAM metadata inspection for feature configuration pages.

import { registerTrustedIpcHandler } from "../electron-security";
import { validateIpcFilePath } from "../lib/ipc-path-validation";
import { peekBam } from "../lib/qc-data-loader";

/** Registers the shared BAM metadata inspection IPC handler. */
export function registerBamInspectionIpcHandlers(): void {
    registerTrustedIpcHandler("peek-bam", async (_event, bamPath: unknown) => {
        if (typeof bamPath !== "string" || bamPath.length === 0) {
            throw new Error(
                "Invalid QC peek-bam request: bamPath must be a non-empty string",
            );
        }
        await validateIpcFilePath(bamPath, "read");
        return peekBam(bamPath);
    });
}
