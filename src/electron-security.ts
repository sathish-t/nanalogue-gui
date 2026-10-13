// Shared Electron security boundaries for renderer loading and privileged IPC.

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
    app,
    type IpcMainInvokeEvent,
    ipcMain,
    net,
    protocol,
    type Session,
    session,
    type WebContents,
    type WindowOpenHandlerResponse,
} from "electron";

/** Custom scheme used exclusively for packaged renderer assets. */
const RENDERER_SCHEME = "nanalogue";

/** Hostname that identifies the trusted application renderer origin. */
const RENDERER_HOST = "renderer";

/** Base URL shared by every trusted renderer page. */
const RENDERER_BASE_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/`;

/** Root directory from which the custom protocol may serve assets. */
const RENDERER_ASSET_ROOT = resolve(__dirname, "renderer");

/** Canonical renderer root used to prevent symbolic-link escapes. */
const RENDERER_ASSET_REAL_ROOT = realpathSync(RENDERER_ASSET_ROOT);

/**
 * Reports whether a URL belongs to the packaged renderer origin.
 *
 * @param candidateUrl - The URL to validate.
 * @returns True only for credential-free URLs on the trusted renderer scheme and host.
 */
export function isTrustedRendererUrl(candidateUrl: string): boolean {
    try {
        const url = new URL(candidateUrl);
        return (
            url.protocol === `${RENDERER_SCHEME}:` &&
            url.host === RENDERER_HOST &&
            url.username.length === 0 &&
            url.password.length === 0
        );
    } catch {
        return false;
    }
}

/**
 * Builds a URL for a packaged renderer asset without granting file protocol privileges.
 *
 * @param relativePath - Slash-separated path below the renderer asset root.
 * @param query - Optional query parameters to append to the renderer URL.
 * @returns A trusted custom-protocol URL for the renderer asset.
 */
export function getRendererAssetUrl(
    relativePath: string,
    query: Record<string, string> = {},
): string {
    const url = new URL(RENDERER_BASE_URL);
    url.pathname = `/${relativePath}`;
    for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, value);
    }
    return url.toString();
}

/**
 * Reports whether a candidate path is contained by a trusted root.
 *
 * @param rootPath - Absolute trusted root path.
 * @param candidatePath - Absolute candidate path.
 * @returns True when the candidate is the root or one of its descendants.
 */
function isPathContainedByRoot(
    rootPath: string,
    candidatePath: string,
): boolean {
    const pathFromRoot = relative(rootPath, candidatePath);
    return (
        pathFromRoot !== ".." &&
        !pathFromRoot.startsWith(`..${sep}`) &&
        !isAbsolute(pathFromRoot)
    );
}

/**
 * Resolves a custom-protocol request to an asset below the packaged renderer root.
 *
 * @param requestUrl - The custom-protocol request URL.
 * @returns The local asset path, or undefined when the URL escapes the trusted root.
 */
function resolveRendererAssetPath(requestUrl: string): string | undefined {
    if (!isTrustedRendererUrl(requestUrl)) return undefined;

    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(new URL(requestUrl).pathname);
    } catch {
        return undefined;
    }
    if (decodedPath.includes("\0")) return undefined;

    const relativePath = decodedPath.replace(/^\/+/, "");
    if (relativePath.length === 0) return undefined;

    const assetPath = resolve(RENDERER_ASSET_ROOT, relativePath);
    if (!isPathContainedByRoot(RENDERER_ASSET_ROOT, assetPath)) {
        return undefined;
    }

    try {
        const realAssetPath = realpathSync(assetPath);
        if (
            !isPathContainedByRoot(RENDERER_ASSET_REAL_ROOT, realAssetPath) ||
            !statSync(realAssetPath).isFile()
        ) {
            return undefined;
        }
        return realAssetPath;
    } catch {
        return undefined;
    }
}

/**
 * Serves a validated packaged renderer asset through Electron's network stack.
 *
 * @param request - The custom-protocol request from Chromium.
 * @returns The local asset response, or a restrictive error response.
 */
function handleRendererAssetRequest(
    request: Request,
): Promise<Response> | Response {
    if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
    }
    const assetPath = resolveRendererAssetPath(request.url);
    if (!assetPath) {
        return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(assetPath).toString());
}

/**
 * Prevents renderer-controlled top-level navigation.
 *
 * @param event - Electron navigation event to cancel.
 */
function preventRendererNavigation(event: Electron.Event): void {
    event.preventDefault();
}

/**
 * Prevents renderer code from attaching a webview with separate preferences.
 *
 * @param event - Electron webview attachment event to cancel.
 */
function preventWebViewAttachment(event: Electron.Event): void {
    event.preventDefault();
}

/**
 * Denies renderer requests to create additional windows.
 *
 * @returns Electron's explicit deny response.
 */
function denyRendererWindowCreation(): WindowOpenHandlerResponse {
    return { action: "deny" };
}

/**
 * Applies navigation, window creation, and webview restrictions to new web contents.
 *
 * @param _event - Electron application event, unused.
 * @param contents - Newly created web contents to harden.
 */
function hardenCreatedWebContents(
    _event: Electron.Event,
    contents: WebContents,
): void {
    contents.on("will-navigate", preventRendererNavigation);
    contents.on("will-attach-webview", preventWebViewAttachment);
    contents.setWindowOpenHandler(denyRendererWindowCreation);
}

/**
 * Enables process sandboxing and registers renderer security policy before app readiness.
 */
export function configureElectronSecurityBeforeReady(): void {
    app.enableSandbox();
    protocol.registerSchemesAsPrivileged([
        {
            scheme: RENDERER_SCHEME,
            privileges: {
                standard: true,
                secure: true,
            },
        },
    ]);
    app.on("web-contents-created", hardenCreatedWebContents);
}

/**
 * Reports whether a clipboard permission comes from a trusted top-level page.
 *
 * @param webContents - Top-level web contents associated with the request.
 * @param permission - Chromium permission name being requested or checked.
 * @param requestingUrl - URL of the frame requesting the permission.
 * @param isMainFrame - Whether the requesting frame is the top-level frame.
 * @returns True only for the clipboard write permission on the trusted main frame.
 */
function isTrustedClipboardPermission(
    webContents: WebContents | null,
    permission: string,
    requestingUrl: string | undefined,
    isMainFrame: boolean,
): boolean {
    return (
        webContents !== null &&
        permission === "clipboard-sanitized-write" &&
        isMainFrame &&
        typeof requestingUrl === "string" &&
        isTrustedRendererUrl(webContents.getURL()) &&
        isTrustedRendererUrl(requestingUrl)
    );
}

/**
 * Restricts permission grants to clipboard writes from trusted application pages.
 *
 * @param targetSession - Electron session whose permission requests should be restricted.
 */
export function restrictSessionPermissions(targetSession: Session): void {
    targetSession.setPermissionCheckHandler(
        /**
         * Checks clipboard permission access without trusting the top-level URL alone.
         *
         * @param webContents - Top-level web contents associated with the check.
         * @param permission - Chromium permission name being checked.
         * @param requestingOrigin - Security origin making the permission check.
         * @param details - Requesting frame URL and frame relationship details.
         * @returns True only for a trusted top-level clipboard write check.
         */
        (webContents, permission, requestingOrigin, details) =>
            isTrustedRendererUrl(requestingOrigin) &&
            isTrustedClipboardPermission(
                webContents,
                permission,
                details.requestingUrl,
                details.isMainFrame,
            ),
    );

    targetSession.setPermissionRequestHandler(
        /**
         * Grants only the clipboard permission used by explicit copy buttons.
         *
         * @param webContents - Web contents requesting the permission.
         * @param permission - Chromium permission name being requested.
         * @param callback - Callback that accepts or denies the request.
         * @param details - Requesting frame URL and frame relationship details.
         */
        (webContents, permission, callback, details) => {
            callback(
                isTrustedClipboardPermission(
                    webContents,
                    permission,
                    details.requestingUrl,
                    details.isMainFrame,
                ),
            );
        },
    );
}

/**
 * Registers the renderer protocol and permission policy after Electron is ready.
 */
export async function configureElectronSecurityAfterReady(): Promise<void> {
    await protocol.handle(RENDERER_SCHEME, handleRendererAssetRequest);
    restrictSessionPermissions(session.defaultSession);
}

/**
 * Rejects IPC from subframes and any sender outside the packaged renderer origin.
 *
 * @param event - Incoming IPC invocation event.
 * @param channel - Channel name used to make rejection errors discoverable.
 */
function assertTrustedIpcSender(
    event: IpcMainInvokeEvent,
    channel: string,
): void {
    const senderFrame = event.senderFrame;
    if (
        !senderFrame ||
        senderFrame.parent !== null ||
        !isTrustedRendererUrl(senderFrame.url)
    ) {
        throw new Error(`Blocked untrusted IPC sender for channel: ${channel}`);
    }
}

/**
 * Registers an IPC handler that runs only for the trusted top-level renderer frame.
 *
 * @param channel - IPC channel name to register.
 * @param handler - Channel implementation called after sender validation.
 */
export function registerTrustedIpcHandler<Arguments extends unknown[], Result>(
    channel: string,
    handler: (
        event: IpcMainInvokeEvent,
        ...args: Arguments
    ) => Result | Promise<Result>,
): void {
    /**
     * Validates the invoking frame before forwarding arguments to the handler.
     *
     * @param event - Incoming Electron IPC event.
     * @param args - Untrusted channel arguments from the renderer.
     * @returns The channel handler's result.
     */
    const trustedHandler = (
        event: IpcMainInvokeEvent,
        ...args: unknown[]
    ): Result | Promise<Result> => {
        assertTrustedIpcSender(event, channel);
        return handler(event, ...(args as Arguments));
    };
    ipcMain.handle(channel, trustedHandler);
}
