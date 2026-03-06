// Tests for the preload contextBridge setup.
// Verifies that exposeInMainWorld is called with "api" and that the exposed
// object contains all expected IPC method names. This guards against
// accidentally removing a channel that renderer pages depend on.
//
// Electron's contextBridge and ipcRenderer are mocked so the preload module
// can be imported in a plain Node.js / vitest environment without a real
// Electron context.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Captured API surface exposed to the renderer.
// ---------------------------------------------------------------------------

/** The API object captured from the contextBridge.exposeInMainWorld call. */
let exposedApi: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted before any import).
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
    contextBridge: {
        /**
         * Captures the exposed API object for inspection by the test suite.
         *
         * @param _name - The world name (expected to be "api").
         * @param api - The API object to expose to the renderer.
         */
        exposeInMainWorld: vi.fn(
            (_name: string, api: Record<string, unknown>) => {
                exposedApi = api;
            },
        ),
    },
    ipcRenderer: {
        /** Stub for ipcRenderer.invoke — returns undefined. */
        invoke: vi.fn(),
        /** Stub for ipcRenderer.on — returns undefined. */
        on: vi.fn(),
        /** Stub for ipcRenderer.removeListener — returns undefined. */
        removeListener: vi.fn(),
    },
}));

// ---------------------------------------------------------------------------
// Import preload after mocks are in place.
// ---------------------------------------------------------------------------

beforeAll(async () => {
    await import("./preload");
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("preload bridge", () => {
    it("calls contextBridge.exposeInMainWorld with the name 'api'", async () => {
        const { contextBridge } = await import("electron");
        expect(vi.mocked(contextBridge.exposeInMainWorld)).toHaveBeenCalledWith(
            "api",
            expect.any(Object),
        );
    });

    it("exposes an object (not a primitive) as the api", () => {
        expect(typeof exposedApi).toBe("object");
        expect(exposedApi).not.toBeNull();
    });

    describe("landing page channels", () => {
        it.each([
            "setFontSize",
            "getVersion",
            "openExternalUrl",
        ])("exposes %s as a function", (name) => {
            expect(typeof exposedApi[name]).toBe("function");
        });
    });

    describe("mode launchers", () => {
        it.each([
            "launchSwipe",
            "launchQC",
            "launchLocate",
            "launchAiChat",
        ])("exposes %s as a function", (name) => {
            expect(typeof exposedApi[name]).toBe("function");
        });
    });

    describe("swipe channels", () => {
        it.each([
            "swipePickBam",
            "swipePickBed",
            "swipePickOutput",
            "swipeCountBedLines",
            "swipeCheckFileExists",
            "swipeStart",
            "swipeGoBack",
            "getState",
            "getPlotData",
            "accept",
            "reject",
        ])("exposes %s as a function", (name) => {
            expect(typeof exposedApi[name]).toBe("function");
        });
    });

    describe("QC channels", () => {
        it.each([
            "peekBam",
            "generateQC",
            "selectFile",
            "goBack",
            "onQCProgress",
            "getQCData",
            "goBackToConfig",
        ])("exposes %s as a function", (name) => {
            expect(typeof exposedApi[name]).toBe("function");
        });
    });

    describe("locate channels", () => {
        it.each([
            "locatePickBam",
            "locatePickReadIds",
            "locatePickOutput",
            "locateCheckFileExists",
            "locateCountReadIds",
            "locateGenerateBed",
            "locateGoBack",
        ])("exposes %s as a function", (name) => {
            expect(typeof exposedApi[name]).toBe("function");
        });
    });

    describe("AI chat channels", () => {
        it.each([
            "aiChatListModels",
            "aiChatSendMessage",
            "aiChatCancel",
            "aiChatNewChat",
            "aiChatPickDirectory",
            "aiChatGoBack",
            "aiChatConsent",
            "aiChatGetSystemPrompt",
            "onAiChatEvent",
        ])("exposes %s as a function", (name) => {
            expect(typeof exposedApi[name]).toBe("function");
        });
    });

    describe("onQCProgress listener", () => {
        it("returns a cleanup function", async () => {
            const cleanup = (
                exposedApi.onQCProgress as (
                    cb: (source: string, count: number) => void,
                ) => unknown
            )(() => undefined);
            expect(typeof cleanup).toBe("function");
        });
    });

    describe("onAiChatEvent listener", () => {
        it("returns a cleanup function", async () => {
            const cleanup = (
                exposedApi.onAiChatEvent as (
                    cb: (event: unknown) => void,
                ) => unknown
            )(() => undefined);
            expect(typeof cleanup).toBe("function");
        });
    });
});

// ---------------------------------------------------------------------------
// Invoke routing — verify every API method forwards to the correct IPC channel
// with the correct arguments.
//
// Each test calls the exposed function and asserts that ipcRenderer.invoke
// (or ipcRenderer.on / removeListener for listener methods) was called with
// the expected channel and payload. The ipcRenderer mock never hits real
// Electron, so these tests run in plain Node.js under vitest.
// ---------------------------------------------------------------------------

describe("invoke routing", () => {
    /** The mocked ipcRenderer, shared across all tests in this describe. */
    let ipcRenderer: {
        /** Mocked ipcRenderer.invoke. */
        invoke: ReturnType<typeof vi.fn>;
        /** Mocked ipcRenderer.on. */
        on: ReturnType<typeof vi.fn>;
        /** Mocked ipcRenderer.removeListener. */
        removeListener: ReturnType<typeof vi.fn>;
    };

    beforeAll(async () => {
        const electron = await import("electron");
        ipcRenderer = electron.ipcRenderer as typeof ipcRenderer;
    });

    beforeEach(() => {
        vi.mocked(ipcRenderer.invoke).mockReset();
        vi.mocked(ipcRenderer.on).mockReset();
        vi.mocked(ipcRenderer.removeListener).mockReset();
    });

    // -----------------------------------------------------------------------
    // Landing page
    // -----------------------------------------------------------------------

    it("setFontSize forwards to set-font-size with the size argument", () => {
        (exposedApi.setFontSize as (size: string) => void)("large");
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "set-font-size",
            "large",
        );
    });

    it("getVersion forwards to get-app-version", () => {
        (exposedApi.getVersion as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith("get-app-version");
    });

    it("openExternalUrl forwards to open-external-url with the url", () => {
        (exposedApi.openExternalUrl as (url: string) => void)(
            "https://example.com",
        );
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "open-external-url",
            "https://example.com",
        );
    });

    // -----------------------------------------------------------------------
    // Mode launchers
    // -----------------------------------------------------------------------

    it.each([
        ["launchSwipe", "launch-swipe"],
        ["launchQC", "launch-qc"],
        ["launchLocate", "launch-locate"],
        ["launchAiChat", "launch-ai-chat"],
    ] as const)("%s forwards to %s", (method, channel) => {
        (exposedApi[method] as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel);
    });

    // -----------------------------------------------------------------------
    // Swipe config
    // -----------------------------------------------------------------------

    it.each([
        ["swipePickBam", "swipe-pick-bam"],
        ["swipePickBed", "swipe-pick-bed"],
        ["swipePickOutput", "swipe-pick-output"],
        ["swipeGoBack", "swipe-go-back"],
    ] as const)("%s forwards to %s", (method, channel) => {
        (exposedApi[method] as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel);
    });

    it("swipeCountBedLines forwards to swipe-count-bed-lines with filePath", () => {
        (exposedApi.swipeCountBedLines as (p: string) => void)("/data/a.bed");
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "swipe-count-bed-lines",
            "/data/a.bed",
        );
    });

    it("swipeCheckFileExists forwards to swipe-check-file-exists with filePath", () => {
        (exposedApi.swipeCheckFileExists as (p: string) => void)(
            "/data/out.bed",
        );
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "swipe-check-file-exists",
            "/data/out.bed",
        );
    });

    it("swipeStart forwards to swipe-start with all arguments", () => {
        (
            exposedApi.swipeStart as (
                bam: string,
                bed: string,
                out: string,
                win: number,
                tag?: string,
                strand?: string,
                flank?: number,
                highlight?: boolean,
                url?: boolean,
            ) => void
        )("/bam", "/bed", "/out", 300, "m", "bc", 500, true, false);

        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "swipe-start",
            "/bam",
            "/bed",
            "/out",
            300,
            "m",
            "bc",
            500,
            true,
            false,
        );
    });

    // -----------------------------------------------------------------------
    // Swipe mode handlers
    // -----------------------------------------------------------------------

    it.each([
        ["getState", "get-state"],
        ["getPlotData", "get-plot-data"],
        ["accept", "accept"],
        ["reject", "reject"],
    ] as const)("%s forwards to %s", (method, channel) => {
        (exposedApi[method] as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel);
    });

    // -----------------------------------------------------------------------
    // QC config
    // -----------------------------------------------------------------------

    it("peekBam forwards to peek-bam with bamPath and treatAsUrl", () => {
        (exposedApi.peekBam as (p: string, url: boolean) => void)(
            "/data/sample.bam",
            false,
        );
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "peek-bam",
            "/data/sample.bam",
            false,
        );
    });

    it("generateQC forwards to generate-qc with the options object", () => {
        const opts = { bamPath: "/data/sample.bam", windowSize: 300 };
        (exposedApi.generateQC as (o: typeof opts) => void)(opts);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith("generate-qc", opts);
    });

    it.each([
        ["selectFile", "select-file"],
        ["goBack", "qc-go-back"],
        ["getQCData", "get-qc-data"],
        ["goBackToConfig", "qc-go-back-to-config"],
    ] as const)("%s forwards to %s", (method, channel) => {
        (exposedApi[method] as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel);
    });

    // -----------------------------------------------------------------------
    // QC progress listener
    // -----------------------------------------------------------------------

    it("onQCProgress registers handler on qc-progress channel", () => {
        const cb = vi.fn();
        (exposedApi.onQCProgress as (cb: typeof cb) => void)(cb);
        expect(ipcRenderer.on).toHaveBeenCalledWith(
            "qc-progress",
            expect.any(Function),
        );
    });

    it("onQCProgress handler forwards source and count to the callback", () => {
        const cb = vi.fn();
        (exposedApi.onQCProgress as (cb: typeof cb) => void)(cb);

        // Retrieve the handler that was passed to ipcRenderer.on and invoke it
        const handler = vi.mocked(ipcRenderer.on).mock.calls[0][1] as (
            _event: unknown,
            source: string,
            count: number,
        ) => void;
        handler(null, "windows", 42);

        expect(cb).toHaveBeenCalledWith("windows", 42);
    });

    it("onQCProgress cleanup removes the listener from qc-progress", () => {
        const cb = vi.fn();
        const cleanup = (
            exposedApi.onQCProgress as (cb: typeof cb) => () => void
        )(cb);

        const handler = vi.mocked(ipcRenderer.on).mock.calls[0][1];
        cleanup();

        expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
            "qc-progress",
            handler,
        );
    });

    // -----------------------------------------------------------------------
    // Locate reads
    // -----------------------------------------------------------------------

    it.each([
        ["locatePickBam", "locate-pick-bam"],
        ["locatePickReadIds", "locate-pick-read-ids"],
        ["locatePickOutput", "locate-pick-output"],
        ["locateGoBack", "locate-go-back"],
    ] as const)("%s forwards to %s", (method, channel) => {
        (exposedApi[method] as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel);
    });

    it("locateCheckFileExists forwards to locate-check-file-exists with filePath", () => {
        (exposedApi.locateCheckFileExists as (p: string) => void)("/ids.txt");
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "locate-check-file-exists",
            "/ids.txt",
        );
    });

    it("locateCountReadIds forwards to locate-count-read-ids with filePath", () => {
        (exposedApi.locateCountReadIds as (p: string) => void)("/ids.txt");
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "locate-count-read-ids",
            "/ids.txt",
        );
    });

    it("locateGenerateBed forwards to locate-generate-bed with all arguments", () => {
        (
            exposedApi.locateGenerateBed as (
                bam: string,
                ids: string,
                out: string,
                url: boolean,
                region?: string,
                full?: boolean,
            ) => void
        )("/bam", "/ids.txt", "/out.bed", false, "chr1:0-1000", true);

        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "locate-generate-bed",
            "/bam",
            "/ids.txt",
            "/out.bed",
            false,
            "chr1:0-1000",
            true,
        );
    });

    // -----------------------------------------------------------------------
    // AI Chat
    // -----------------------------------------------------------------------

    it("aiChatListModels forwards to ai-chat-list-models with the payload", () => {
        const payload = {
            endpointUrl: "http://localhost:11434/v1",
            apiKey: "",
        };
        (exposedApi.aiChatListModels as (p: typeof payload) => void)(payload);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "ai-chat-list-models",
            payload,
        );
    });

    it("aiChatSendMessage forwards to ai-chat-send-message with the payload", () => {
        const payload = {
            endpointUrl: "http://localhost:11434/v1",
            apiKey: "",
            model: "llama3",
            message: "How many reads?",
            allowedDir: "/data",
            config: {},
        };
        (exposedApi.aiChatSendMessage as (p: typeof payload) => void)(payload);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "ai-chat-send-message",
            payload,
        );
    });

    it.each([
        ["aiChatCancel", "ai-chat-cancel"],
        ["aiChatNewChat", "ai-chat-new-chat"],
        ["aiChatPickDirectory", "ai-chat-pick-directory"],
    ] as const)("%s forwards to %s", (method, channel) => {
        (exposedApi[method] as () => void)();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel);
    });

    it("aiChatGoBack invokes ai-chat-go-back then ai-chat-go-back-nav", async () => {
        await (exposedApi.aiChatGoBack as () => Promise<void>)();
        expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
            1,
            "ai-chat-go-back",
        );
        expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
            2,
            "ai-chat-go-back-nav",
        );
    });

    it("aiChatConsent forwards to ai-chat-consent with the origin", () => {
        (exposedApi.aiChatConsent as (o: string) => void)(
            "https://api.example.com",
        );
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "ai-chat-consent",
            "https://api.example.com",
        );
    });

    it("aiChatGetSystemPrompt forwards to ai-chat-get-system-prompt with payload", () => {
        const payload = { config: { maxRetries: 3 }, allowedDir: "/data" };
        (exposedApi.aiChatGetSystemPrompt as (p: typeof payload) => void)(
            payload,
        );
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            "ai-chat-get-system-prompt",
            payload,
        );
    });

    // -----------------------------------------------------------------------
    // AI Chat event listener
    // -----------------------------------------------------------------------

    it("onAiChatEvent registers handler on ai-chat-event channel", () => {
        const cb = vi.fn();
        (exposedApi.onAiChatEvent as (cb: typeof cb) => void)(cb);
        expect(ipcRenderer.on).toHaveBeenCalledWith(
            "ai-chat-event",
            expect.any(Function),
        );
    });

    it("onAiChatEvent handler strips the Electron event and forwards data to callback", () => {
        const cb = vi.fn();
        (exposedApi.onAiChatEvent as (cb: typeof cb) => void)(cb);

        const handler = vi.mocked(ipcRenderer.on).mock.calls[0][1] as (
            _event: unknown,
            data: unknown,
        ) => void;
        handler(null, { type: "turn_start" });

        expect(cb).toHaveBeenCalledWith({ type: "turn_start" });
    });

    it("onAiChatEvent cleanup removes the listener from ai-chat-event", () => {
        const cb = vi.fn();
        const cleanup = (
            exposedApi.onAiChatEvent as (cb: typeof cb) => () => void
        )(cb);

        const handler = vi.mocked(ipcRenderer.on).mock.calls[0][1];
        cleanup();

        expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
            "ai-chat-event",
            handler,
        );
    });
});
