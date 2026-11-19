import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const writeFileMock = vi.hoisted(() => vi.fn());
const lstatMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    writeFile: writeFileMock,
    lstat: lstatMock,
}));

const { makeWriteFile } = await import("./write-file");

let allowedDir: string;

afterEach(async () => {
    writeFileMock.mockReset();
    lstatMock.mockReset();
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

it("makeWriteFile preserves unexpected errors while checking a session file", async () => {
    allowedDir = await realpath(
        await mkdtemp(join(tmpdir(), "write-file-lstat-errors-")),
    );
    const fs =
        await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
        );
    writeFileMock.mockImplementation(fs.writeFile);
    const lstatError = Object.assign(new Error("simulated lstat failure"), {
        code: "EACCES",
    });
    lstatMock.mockRejectedValueOnce(lstatError);
    const fn = makeWriteFile(allowedDir, 1024 * 1024);

    await fn("session.txt", "first");
    await expect(fn("session.txt", "second")).rejects.toBe(lstatError);
});
