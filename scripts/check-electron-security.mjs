#!/usr/bin/env node

// Structural regression checks for Electron renderer and main-process security.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRUSTED_IPC_REGISTRAR = "src/electron-security.ts";
const REQUIRED_CSP =
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

/** Validates effective CSP metadata and restricts access to privileged Electron imports. */
export function validateElectronSecuritySource(filePath, content) {
    const failures = [];
    if (filePath.endsWith(".html")) {
        const dom = new JSDOM(content);
        const { document, Node } = dom.window;
        const policies = [...document.head.querySelectorAll("meta")].filter(
            (meta) =>
                meta.getAttribute("http-equiv")?.toLowerCase() ===
                "content-security-policy",
        );
        const policy = policies[0];
        const resources = document.querySelectorAll("script, link");
        if (
            policies.length !== 1 ||
            policy.parentElement !== document.head ||
            policy.getAttribute("content") !== REQUIRED_CSP ||
            [...resources].some(
                (resource) =>
                    !(
                        policy.compareDocumentPosition(resource) &
                        Node.DOCUMENT_POSITION_FOLLOWING
                    ),
            )
        ) {
            failures.push(
                `${filePath}: missing an early restrictive CSP meta element`,
            );
        }
        dom.window.close();
        return failures;
    }

    const source = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
    );
    let ipcRegistrations = 0;
    // Restrict the import boundary instead of trying to enumerate every IPC method
    // or follow arbitrary aliases. Namespace, require and dynamic imports cannot
    // silently grant a second route to ipcMain or shell.
    function visit(node) {
        // Reserve the ipc property: scoped WebContents/WebFrameMain handlers must
        // not bypass the global validator, including via destructured aliases.
        // There are no legitimate ipc property reads in production code.
        let property;
        if (ts.isPropertyAccessExpression(node)) {
            property = node.name;
        } else if (
            ts.isElementAccessExpression(node) &&
            (ts.isStringLiteral(node.argumentExpression) ||
                ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
        ) {
            property = node.argumentExpression;
        } else if (
            ts.isBindingElement(node) &&
            ts.isObjectBindingPattern(node.parent)
        ) {
            property = node.propertyName ?? node.name;
            if (ts.isComputedPropertyName(property)) {
                property = property.expression;
            }
        }
        if (property?.text === "ipc") {
            failures.push(
                `${filePath}: scoped ipc access bypasses the trusted registrar`,
            );
        }
        if (
            (ts.isStringLiteral(node) ||
                ts.isNoSubstitutionTemplateLiteral(node)) &&
            (node.text === "electron" || node.text.startsWith("electron/"))
        ) {
            const declaration = node.parent;
            const clause = ts.isImportDeclaration(declaration)
                ? declaration.importClause
                : undefined;
            if (clause?.isTypeOnly || ts.isImportTypeNode(declaration.parent)) {
                return;
            }
            const bindings = clause?.namedBindings;
            if (clause?.name || !bindings || !ts.isNamedImports(bindings)) {
                failures.push(`${filePath}: use named Electron imports only`);
            } else {
                for (const binding of bindings.elements) {
                    if (binding.isTypeOnly) continue;
                    const importedName = (binding.propertyName ?? binding.name)
                        .text;
                    if (importedName === "shell") {
                        failures.push(
                            `${filePath}: Electron shell access is prohibited`,
                        );
                    }
                    if (
                        importedName === "ipcMain" &&
                        (filePath !== TRUSTED_IPC_REGISTRAR ||
                            binding.name.text !== "ipcMain")
                    ) {
                        failures.push(
                            `${filePath}: ipcMain must stay in the trusted registrar`,
                        );
                    }
                }
            }
        }
        if (
            ts.isIdentifier(node) &&
            node.text === "ipcMain" &&
            !ts.isImportSpecifier(node.parent)
        ) {
            const access = node.parent;
            if (
                filePath === TRUSTED_IPC_REGISTRAR &&
                ts.isPropertyAccessExpression(access) &&
                access.expression === node &&
                access.name.text === "handle" &&
                ts.isCallExpression(access.parent) &&
                access.parent.expression === access
            ) {
                ipcRegistrations += 1;
            } else {
                failures.push(
                    `${filePath}: ipcMain may only register the central handler`,
                );
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    if (filePath === TRUSTED_IPC_REGISTRAR && ipcRegistrations !== 1) {
        failures.push(
            `${filePath}: expected exactly one central ipcMain registration`,
        );
    }
    return failures;
}

/** Returns repository-tracked file paths. */
function listTrackedFiles() {
    return execFileSync("git", ["ls-files", "-z"], {
        cwd: ROOT,
        encoding: "utf8",
    })
        .split("\0")
        .filter(Boolean);
}

/** Reads a repository-relative text file. */
function readRepositoryFile(filePath) {
    return readFileSync(join(ROOT, filePath), "utf8");
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    const trackedFiles = listTrackedFiles();
    const rendererHtmlFiles = trackedFiles.filter(
        (filePath) =>
            filePath.startsWith("src/renderer/") && filePath.endsWith(".html"),
    );
    const productionTypeScriptFiles = trackedFiles.filter(
        (filePath) =>
            filePath.startsWith("src/") &&
            filePath.endsWith(".ts") &&
            !filePath.endsWith(".test.ts"),
    );
    const failures = [
        ...rendererHtmlFiles,
        ...productionTypeScriptFiles,
    ].flatMap((filePath) =>
        validateElectronSecuritySource(filePath, readRepositoryFile(filePath)),
    );
    if (rendererHtmlFiles.length === 0) {
        failures.push("No renderer HTML files were found for CSP validation");
    }
    if (failures.length > 0) {
        console.error("Electron security structure check FAILED:");
        for (const failure of failures) console.error(`  ✗ ${failure}`);
        process.exitCode = 1;
    } else {
        console.log(
            `Electron security structure check passed across ${rendererHtmlFiles.length} renderer page(s) and ${productionTypeScriptFiles.length} production TypeScript file(s).`,
        );
    }
}
