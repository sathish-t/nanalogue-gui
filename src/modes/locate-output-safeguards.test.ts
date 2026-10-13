import {
    link,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

/* eslint-disable jsdoc/require-jsdoc */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: (
            name: string,
            handler: (...args: unknown[]) => Promise<unknown>,
        ) => handlers.set(name, handler),
    },
    dialog: { showOpenDialog: vi.fn() },
}));
vi.mock("@nanalogue/node", () => ({ readInfo: vi.fn().mockResolvedValue([]) }));

const { readInfo } = await import("@nanalogue/node");
const { registerLocateIpcHandlers } = await import("./locate");

let testDir: string;

beforeAll(() => {
    registerLocateIpcHandlers();
});

afterEach(async () => {
    if (testDir) await rm(testDir, { recursive: true, force: true });
});

async function makeLocatePaths(): Promise<{
    bamPath: string;
    readIdPath: string;
}> {
    testDir = await mkdtemp(join(tmpdir(), "locate-output-safeguards-"));
    const bamPath = join(testDir, "input.bam");
    const readIdPath = join(testDir, "read-ids.txt");
    await writeFile(bamPath, "bam input");
    await writeFile(readIdPath, "read-1\n");
    return { bamPath, readIdPath };
}

async function generateLocateBed(
    bamPath: string,
    readIdPath: string,
    outputPath: string,
): Promise<unknown> {
    const generate = handlers.get("locate-generate-bed");
    if (!generate)
        throw new Error("Locate generate handler was not registered");
    return generate(
        {},
        {
            bamPath,
            readIdPath,
            outputPath,
            overwriteConfirmed: true,
        },
    );
}

it("rejects an output path equal to the read ID input", async () => {
    const { bamPath, readIdPath } = await makeLocatePaths();

    await expect(
        generateLocateBed(bamPath, readIdPath, readIdPath),
    ).rejects.toThrow("same file as an input");
    await expect(readFile(readIdPath, "utf-8")).resolves.toBe("read-1\n");
});

it("writes to a distinct output path that does not exist yet", async () => {
    const { bamPath, readIdPath } = await makeLocatePaths();
    const outputPath = join(testDir, "output.bed");

    await expect(
        generateLocateBed(bamPath, readIdPath, outputPath),
    ).resolves.toMatchObject({ totalIds: 1, found: 0 });
    await expect(readFile(outputPath, "utf-8")).resolves.toBe("");
});

it("rejects an output alias through a symlinked parent directory", async () => {
    const { bamPath, readIdPath } = await makeLocatePaths();
    const actualParent = join(testDir, "actual");
    const aliasedParent = join(testDir, "aliased");
    await mkdir(actualParent);
    const nestedReadIds = join(actualParent, "read-ids.txt");
    await writeFile(nestedReadIds, "read-1\n");
    await symlink(actualParent, aliasedParent, "dir");

    await expect(
        generateLocateBed(
            bamPath,
            nestedReadIds,
            join(aliasedParent, "read-ids.txt"),
        ),
    ).rejects.toThrow("same file as an input");
    await expect(readFile(nestedReadIds, "utf-8")).resolves.toBe("read-1\n");
    expect(readIdPath).not.toBe(nestedReadIds);
});

it("rejects an existing output that is a hard-link alias of an input", async () => {
    const { bamPath, readIdPath } = await makeLocatePaths();
    const outputPath = join(testDir, "output.bed");
    await link(readIdPath, outputPath);

    await expect(
        generateLocateBed(bamPath, readIdPath, outputPath),
    ).rejects.toThrow("same file as an input");
    await expect(readFile(readIdPath, "utf-8")).resolves.toBe("read-1\n");
});

it("rejects an existing output that is a hard-link alias of the BAM input", async () => {
    const { bamPath, readIdPath } = await makeLocatePaths();
    const outputPath = join(testDir, "output.bed");
    await link(bamPath, outputPath);

    await expect(
        generateLocateBed(bamPath, readIdPath, outputPath),
    ).rejects.toThrow("same file as an input");
    await expect(readFile(bamPath, "utf-8")).resolves.toBe("bam input");
});

it("rechecks output identity after asynchronous BAM loading", async () => {
    const { bamPath, readIdPath } = await makeLocatePaths();
    const outputPath = join(testDir, "output.bed");
    let finishReadInfo: ((records: []) => void) | undefined;
    vi.mocked(readInfo).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finishReadInfo = resolve;
            }),
    );

    const previousReadInfoCalls = vi.mocked(readInfo).mock.calls.length;
    const generation = generateLocateBed(bamPath, readIdPath, outputPath);
    await vi.waitFor(() =>
        expect(readInfo).toHaveBeenCalledTimes(previousReadInfoCalls + 1),
    );
    await link(readIdPath, outputPath);
    if (!finishReadInfo) throw new Error("Locate readInfo did not start");
    finishReadInfo([]);

    await expect(generation).rejects.toThrow("same file as an input");
    await expect(readFile(readIdPath, "utf-8")).resolves.toBe("read-1\n");
});
