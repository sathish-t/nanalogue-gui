import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const writeFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    writeFile: writeFileMock,
}));

const { makeWriteFile } = await import("./write-file");

let allowedDir: string;

afterEach(async () => {
    writeFileMock.mockReset();
    if (allowedDir) await rm(allowedDir, { recursive: true, force: true });
});

it("makeWriteFile preserves non-EEXIST filesystem errors", async () => {
    allowedDir = await realpath(
        await mkdtemp(join(tmpdir(), "write-file-errors-")),
    );
    const writeError = Object.assign(new Error("simulated write failure"), {
        code: "EIO",
    });
    writeFileMock.mockRejectedValueOnce(writeError);
    const fn = makeWriteFile(allowedDir, 1024 * 1024);

    await expect(fn("write-error.txt", "content")).rejects.toBe(writeError);
});
