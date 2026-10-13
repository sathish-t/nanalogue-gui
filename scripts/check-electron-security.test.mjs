// Security checker regression cases: unsafe mutations must fail, valid syntax must pass.

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateElectronSecuritySource } from "./check-electron-security.mjs";

const policy =
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
const htmlPath = "src/renderer/example.html";
const modePath = "src/modes/example.ts";
const registrarPath = "src/electron-security.ts";

test("accepts an early effective CSP independent of attribute order and case", () => {
    assert.deepEqual(
        validateElectronSecuritySource(
            htmlPath,
            `<head><META content="${policy}" HTTP-EQUIV='content-security-policy'><script src="app.js"></script></head>`,
        ),
        [],
    );
});

test("rejects CSP text that the browser would not enforce or that arrives too late", () => {
    for (const content of [
        `<head>${meta.replace('http-equiv="Content-Security-Policy"', 'name="description"')}</head>`,
        `<head><!-- ${meta} --></head>`,
        `<head><template>${meta}</template></head>`,
        `<head><noscript>${meta}</noscript><script src="app.js"></script></head>`,
        `<head></head><body>${meta}</body>`,
        `<head><script src="app.js"></script>${meta}</head>`,
        `<head>${meta.replace("script-src 'self'", "script-src *")}</head>`,
    ]) {
        assert.notDeepEqual(
            validateElectronSecuritySource(htmlPath, content),
            [],
            content,
        );
    }
});

test("permits named safe Electron imports and the single central IPC registration", () => {
    assert.deepEqual(
        validateElectronSecuritySource(
            modePath,
            'import { dialog as picker, type BrowserWindow } from "electron"; picker.showOpenDialog();',
        ),
        [],
    );
    assert.deepEqual(
        validateElectronSecuritySource(
            modePath,
            'import type { IpcMain } from "electron"; type Window = import("electron").BrowserWindow;',
        ),
        [],
    );
    assert.deepEqual(
        validateElectronSecuritySource(
            registrarPath,
            'import { ipcMain } from "electron"; ipcMain.handle(channel, trustedHandler);',
        ),
        [],
    );
});

test("rejects raw IPC access including aliases, handleOnce and alternate import forms", () => {
    for (const content of [
        'import { ipcMain } from "electron"; ipcMain.handle("x", handler);',
        'import { ipcMain } from "electron/main"; ipcMain.handleOnce("x", handler);',
        'import { ipcMain as messages } from "electron"; messages.on("x", handler);',
        'import * as electron from "electron"; electron.ipcMain.once("x", handler);',
        'import electron from "electron"; electron.ipcMain.handle("x", handler);',
        'const { ipcMain: messages } = require("electron"); messages.handle("x", handler);',
        'const { ipcMain: messages } = await import("electron/main"); messages.handle("x", handler);',
        'const { ipcMain: messages } = await import(`electron`); messages.handle("x", handler);',
        'export { ipcMain as messages } from "electron";',
    ]) {
        assert.notDeepEqual(
            validateElectronSecuritySource(modePath, content),
            [],
            content,
        );
    }
});

test("rejects shell access even with an alias or a destructured method", () => {
    for (const content of [
        'import { shell } from "electron"; shell.openExternal(url);',
        'import { shell as os } from "electron"; const { openExternal: open } = os; open(url);',
        'const { shell: os } = require("electron"); os["openExternal"](url);',
    ]) {
        assert.notDeepEqual(
            validateElectronSecuritySource(modePath, content),
            [],
            content,
        );
    }
});

test("rejects window and frame IPC access before it can be aliased or registered", () => {
    const centralHandler =
        'import { ipcMain } from "electron"; ipcMain.handle(channel, trustedHandler);';
    for (const content of [
        'import { webContents } from "electron"; webContents.getAllWebContents()[0].ipc.handle("x", handler);',
        'window.webContents.ipc.handleOnce("x", handler);',
        'event.senderFrame.ipc.on("x", handler);',
        'frame.ipc.once("x", handler);',
        'const messages = contents["ipc"]; messages.handle("x", handler);',
        'const messages = frame[`ipc`]; messages.on("x", handler);',
        'const { ipc } = contents; ipc.handle("x", handler);',
        'const { ipc: messages } = frame; messages.on("x", handler);',
        'const { ["ipc"]: messages } = contents; messages.handle("x", handler);',
    ]) {
        assert.notDeepEqual(
            validateElectronSecuritySource(modePath, content),
            [],
            content,
        );
        // The central registrar cannot grow a scoped path around its validator either.
        assert.notDeepEqual(
            validateElectronSecuritySource(
                registrarPath,
                `${centralHandler}\n${content}`,
            ),
            [],
            content,
        );
    }
    assert.deepEqual(
        validateElectronSecuritySource(
            modePath,
            'window.webContents.send("update", data); event.senderFrame.url; const ipcLabel = "ipc";',
        ),
        [],
    );
});

test("does not let the central registrar acquire extra IPC paths", () => {
    const valid =
        'import { ipcMain } from "electron"; ipcMain.handle(channel, trustedHandler);';
    for (const content of [
        valid.replace(".handle(", ".handleOnce("),
        `${valid} ipcMain.on("extra", handler);`,
        `${valid} ipcMain.handle("extra", handler);`,
        `${valid} const alias = ipcMain; alias.handle("extra", handler);`,
    ]) {
        assert.notDeepEqual(
            validateElectronSecuritySource(registrarPath, content),
            [],
            content,
        );
    }
});
