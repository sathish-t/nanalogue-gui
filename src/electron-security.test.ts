// Tests for Electron's shared renderer, protocol, permission, and IPC boundaries.

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** URL of a trusted top-level renderer page used by permission tests. */
const TRUSTED_RENDERER_URL = "nanalogue://renderer/ai-chat/ai-chat.html";

/** Minimal web contents surface used by permission-handler tests. */
interface MockPermissionWebContents {
    /** Returns the current top-level page URL. */
    getURL: () => string;
}

/** Frame details shared by mocked permission checks and requests. */
interface MockPermissionDetails {
    /** Whether the requesting frame is the top-level frame. */
    isMainFrame: boolean;
    /** Last URL loaded by the requesting frame. */
    requestingUrl?: string;
}

/** Mocked Electron permission request handler signature. */
type MockPermissionRequestHandler = (
    webContents: MockPermissionWebContents,
    permission: string,
    callback: (allowed: boolean) => void,
    details: MockPermissionDetails,
) => void;

/** Mocked Electron permission check handler signature. */
type MockPermissionCheckHandler = (
    webContents: MockPermissionWebContents | null,
    permission: string,
    requestingOrigin: string,
    details: MockPermissionDetails,
) => boolean;

/** IPC handlers captured from the mocked Electron registrar. */
const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();

/** Custom protocol handler captured during after-ready configuration. */
let rendererProtocolHandler:
    | ((request: Request) => Promise<Response> | Response)
    | undefined;

/** Application web-contents-created handler captured during configuration. */
let webContentsCreatedHandler:
    | ((event: unknown, contents: Record<string, unknown>) => void)
    | undefined;

/** Session permission handler captured by the mocked default session. */
let permissionRequestHandler: MockPermissionRequestHandler | undefined;

/** Session permission check handler captured by the mocked default session. */
let permissionCheckHandler: MockPermissionCheckHandler | undefined;

/** Temporary external directory used by the protocol symlink test. */
let protocolOutsideDirectory: string | undefined;

/** Renderer-root symlink used by the protocol symlink test. */
let protocolSymlinkPath: string | undefined;

vi.mock("electron", () => ({
    app: {
        enableSandbox: vi.fn(),
        on: vi.fn(
            (
                eventName: string,
                handler: (
                    event: unknown,
                    contents: Record<string, unknown>,
                ) => void,
            ) => {
                if (eventName === "web-contents-created") {
                    webContentsCreatedHandler = handler;
                }
            },
        ),
    },
    ipcMain: {
        handle: vi.fn(
            (channel: string, handler: (...args: unknown[]) => unknown) => {
                ipcHandlers.set(channel, handler);
            },
        ),
    },
    net: {
        fetch: vi.fn(async () => new Response("asset")),
    },
    protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(
            async (
                _scheme: string,
                handler: (request: Request) => Promise<Response> | Response,
            ) => {
                rendererProtocolHandler = handler;
            },
        ),
    },
    session: {
        defaultSession: {
            setPermissionCheckHandler: vi.fn(
                (handler: MockPermissionCheckHandler) => {
                    permissionCheckHandler = handler;
                },
            ),
            setPermissionRequestHandler: vi.fn(
                (handler: MockPermissionRequestHandler) => {
                    permissionRequestHandler = handler;
                },
            ),
        },
    },
}));

const electron = await import("electron");
const {
    configureElectronSecurityAfterReady,
    configureElectronSecurityBeforeReady,
    getRendererAssetUrl,
    isTrustedRendererUrl,
    registerTrustedIpcHandler,
    restrictSessionPermissions,
} = await import("./electron-security");

/**
 * Returns mocked web contents at the given top-level page URL.
 *
 * @param pageUrl - URL reported by the mocked top-level page.
 * @returns Minimal web contents with the requested page URL.
 */
function makePermissionWebContents(
    pageUrl = TRUSTED_RENDERER_URL,
): MockPermissionWebContents {
    return {
        /**
         * Returns the configured top-level page URL.
         *
         * @returns Configured page URL.
         */
        getURL: () => pageUrl,
    };
}

afterEach(() => {
    if (protocolSymlinkPath) rmSync(protocolSymlinkPath, { force: true });
    if (protocolOutsideDirectory) {
        rmSync(protocolOutsideDirectory, { force: true, recursive: true });
    }
    protocolSymlinkPath = undefined;
    protocolOutsideDirectory = undefined;
});

describe("trusted renderer URLs", () => {
    it("builds query-bearing URLs on the custom renderer origin", () => {
        expect(
            getRendererAssetUrl("landing/landing.html", {
                fontSize: "large",
            }),
        ).toBe("nanalogue://renderer/landing/landing.html?fontSize=large");
    });

    it.each([
        "https://renderer/landing/landing.html",
        "file:///tmp/landing.html",
        "nanalogue://attacker/landing/landing.html",
        "nanalogue://credentials@renderer/landing/landing.html",
        "not a URL",
    ])("rejects untrusted renderer URL %s", (candidateUrl) => {
        expect(isTrustedRendererUrl(candidateUrl)).toBe(false);
    });

    it("accepts packaged pages on the renderer origin", () => {
        expect(
            isTrustedRendererUrl(
                "nanalogue://renderer/qc/qc-results.html?fontSize=medium",
            ),
        ).toBe(true);
    });
});

describe("Electron renderer policy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        webContentsCreatedHandler = undefined;
    });

    it("enables the sandbox and registers a standard secure scheme", () => {
        configureElectronSecurityBeforeReady();

        expect(electron.app.enableSandbox).toHaveBeenCalledOnce();
        expect(
            electron.protocol.registerSchemesAsPrivileged,
        ).toHaveBeenCalledWith([
            {
                scheme: "nanalogue",
                privileges: { secure: true, standard: true },
            },
        ]);
    });

    it("blocks renderer navigation, windows, and webviews", () => {
        configureElectronSecurityBeforeReady();
        const listeners = new Map<
            string,
            (event: {
                /** Cancels the event's default action. */
                preventDefault: () => void;
            }) => void
        >();
        let windowOpenHandler:
            | (() => {
                  /** Electron's window creation decision. */
                  action: "deny";
              })
            | undefined;
        const contents = {
            on: vi.fn(
                (
                    eventName: string,
                    handler: (event: {
                        /** Cancels the event's default action. */
                        preventDefault: () => void;
                    }) => void,
                ) => {
                    listeners.set(eventName, handler);
                },
            ),
            setWindowOpenHandler: vi.fn(
                (
                    handler: () => {
                        /** Electron's window creation decision. */
                        action: "deny";
                    },
                ) => {
                    windowOpenHandler = handler;
                },
            ),
        };

        webContentsCreatedHandler?.({}, contents);
        const navigationEvent = { preventDefault: vi.fn() };
        const webViewEvent = { preventDefault: vi.fn() };
        listeners.get("will-navigate")?.(navigationEvent);
        listeners.get("will-attach-webview")?.(webViewEvent);

        expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();
        expect(webViewEvent.preventDefault).toHaveBeenCalledOnce();
        expect(windowOpenHandler?.()).toEqual({ action: "deny" });
    });
});

describe("renderer asset protocol", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        rendererProtocolHandler = undefined;
        await configureElectronSecurityAfterReady();
    });

    it("serves only assets below the packaged renderer root", async () => {
        const response = await rendererProtocolHandler?.(
            new Request("nanalogue://renderer/landing/landing.html"),
        );

        expect(response?.status).toBe(200);
        expect(electron.net.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/src\/renderer\/landing\/landing\.html$/),
        );
    });

    it("rejects encoded path traversal before reading a file", async () => {
        const response = await rendererProtocolHandler?.(
            new Request("nanalogue://renderer/..%2Fpackage.json"),
        );

        expect(response?.status).toBe(404);
        expect(electron.net.fetch).not.toHaveBeenCalled();
    });

    it("rejects malformed percent encoding before reading a file", async () => {
        const response = await rendererProtocolHandler?.(
            new Request("nanalogue://renderer/%E0%A4%A"),
        );

        expect(response?.status).toBe(404);
        expect(electron.net.fetch).not.toHaveBeenCalled();
    });

    it("rejects missing assets before invoking the network stack", async () => {
        const response = await rendererProtocolHandler?.(
            new Request("nanalogue://renderer/missing-security-test.html"),
        );

        expect(response?.status).toBe(404);
        expect(electron.net.fetch).not.toHaveBeenCalled();
    });

    it("rejects renderer directories rather than serving them as files", async () => {
        const response = await rendererProtocolHandler?.(
            new Request("nanalogue://renderer/shared"),
        );

        expect(response?.status).toBe(404);
        expect(electron.net.fetch).not.toHaveBeenCalled();
    });

    it("rejects symlinks that resolve outside the renderer root", async () => {
        protocolOutsideDirectory = mkdtempSync(
            join(tmpdir(), "nanalogue-renderer-security-"),
        );
        const outsideFile = join(protocolOutsideDirectory, "outside.html");
        writeFileSync(outsideFile, "outside renderer root", "utf8");
        protocolSymlinkPath = join(
            import.meta.dirname,
            "renderer",
            `.security-test-${process.pid}.html`,
        );
        symlinkSync(outsideFile, protocolSymlinkPath);

        const response = await rendererProtocolHandler?.(
            new Request(
                `nanalogue://renderer/${basename(protocolSymlinkPath)}`,
            ),
        );

        expect(response?.status).toBe(404);
        expect(electron.net.fetch).not.toHaveBeenCalled();
    });

    it("rejects non-GET renderer asset requests", async () => {
        const response = await rendererProtocolHandler?.(
            new Request("nanalogue://renderer/landing/landing.html", {
                method: "POST",
            }),
        );

        expect(response?.status).toBe(405);
        expect(electron.net.fetch).not.toHaveBeenCalled();
    });
});

describe("session permission policy", () => {
    beforeEach(() => {
        permissionRequestHandler = undefined;
        permissionCheckHandler = undefined;
        restrictSessionPermissions(electron.session.defaultSession);
    });

    it("allows trusted top-level renderer clipboard requests", () => {
        const callback = vi.fn();
        permissionRequestHandler?.(
            makePermissionWebContents(),
            "clipboard-sanitized-write",
            callback,
            { isMainFrame: true, requestingUrl: TRUSTED_RENDERER_URL },
        );

        expect(callback).toHaveBeenCalledWith(true);
    });

    it("allows trusted top-level renderer clipboard checks", () => {
        expect(
            permissionCheckHandler?.(
                makePermissionWebContents(),
                "clipboard-sanitized-write",
                "nanalogue://renderer",
                { isMainFrame: true, requestingUrl: TRUSTED_RENDERER_URL },
            ),
        ).toBe(true);
    });

    it.each([
        [
            "remote requesting frame",
            TRUSTED_RENDERER_URL,
            "clipboard-sanitized-write",
            "https://attacker.example",
            true,
        ],
        [
            "remote top-level page",
            "https://attacker.example",
            "clipboard-sanitized-write",
            TRUSTED_RENDERER_URL,
            true,
        ],
        [
            "trusted subframe",
            TRUSTED_RENDERER_URL,
            "clipboard-sanitized-write",
            TRUSTED_RENDERER_URL,
            false,
        ],
        [
            "different permission",
            TRUSTED_RENDERER_URL,
            "notifications",
            TRUSTED_RENDERER_URL,
            true,
        ],
    ])("denies a %s permission request", (_label, topLevelUrl, permission, requestingUrl, isMainFrame) => {
        const callback = vi.fn();
        permissionRequestHandler?.(
            makePermissionWebContents(topLevelUrl),
            permission,
            callback,
            { isMainFrame, requestingUrl },
        );

        expect(callback).toHaveBeenCalledWith(false);
    });

    it.each([
        [
            "missing web contents",
            null,
            "clipboard-sanitized-write",
            "nanalogue://renderer",
            TRUSTED_RENDERER_URL,
            true,
        ],
        [
            "remote top-level page",
            makePermissionWebContents("https://attacker.example"),
            "clipboard-sanitized-write",
            "nanalogue://renderer",
            TRUSTED_RENDERER_URL,
            true,
        ],
        [
            "remote requesting origin",
            makePermissionWebContents(),
            "clipboard-sanitized-write",
            "https://attacker.example",
            TRUSTED_RENDERER_URL,
            true,
        ],
        [
            "remote requesting frame",
            makePermissionWebContents(),
            "clipboard-sanitized-write",
            "nanalogue://renderer",
            "https://attacker.example",
            true,
        ],
        [
            "missing requesting frame URL",
            makePermissionWebContents(),
            "clipboard-sanitized-write",
            "nanalogue://renderer",
            undefined,
            true,
        ],
        [
            "trusted subframe",
            makePermissionWebContents(),
            "clipboard-sanitized-write",
            "nanalogue://renderer",
            TRUSTED_RENDERER_URL,
            false,
        ],
        [
            "different permission",
            makePermissionWebContents(),
            "notifications",
            "nanalogue://renderer",
            TRUSTED_RENDERER_URL,
            true,
        ],
    ])("denies a %s permission check", (_label, webContents, permission, requestingOrigin, requestingUrl, isMainFrame) => {
        expect(
            permissionCheckHandler?.(
                webContents,
                permission,
                requestingOrigin,
                { isMainFrame, requestingUrl },
            ),
        ).toBe(false);
    });

    it("registers both required Electron permission handler paths", () => {
        expect(permissionRequestHandler).toBeTypeOf("function");
        expect(permissionCheckHandler).toBeTypeOf("function");
    });
});

describe("trusted IPC registration", () => {
    beforeEach(() => {
        ipcHandlers.clear();
    });

    it("forwards IPC from the trusted top-level renderer", () => {
        registerTrustedIpcHandler("secure-channel", (_event, value: string) =>
            value.toUpperCase(),
        );
        const handler = ipcHandlers.get("secure-channel");

        expect(
            handler?.(
                {
                    senderFrame: {
                        parent: null,
                        url: "nanalogue://renderer/landing/landing.html",
                    },
                },
                "safe",
            ),
        ).toBe("SAFE");
    });

    it.each([
        ["remote frame", { parent: null, url: "https://attacker.example" }],
        [
            "trusted-origin subframe",
            {
                parent: {},
                url: "nanalogue://renderer/landing/landing.html",
            },
        ],
        ["missing frame", undefined],
    ])("blocks IPC from a %s", (_label, senderFrame) => {
        registerTrustedIpcHandler("secure-channel", () => "unsafe");
        const handler = ipcHandlers.get("secure-channel");

        expect(() => handler?.({ senderFrame })).toThrow(
            "Blocked untrusted IPC sender for channel: secure-channel",
        );
    });
});
