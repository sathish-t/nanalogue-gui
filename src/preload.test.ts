// Tests for the preload contextBridge setup.
// Verifies that exposeInMainWorld is called with "api" and that the exposed
// object contains all expected IPC method names. This guards against
// accidentally removing a channel that renderer pages depend on.
//
// Electron's contextBridge and ipcRenderer are mocked so the preload module
// can be imported in a plain Node.js / vitest environment without a real
// Electron context.

import { beforeAll, describe, expect, it, vi } from "vitest";

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
