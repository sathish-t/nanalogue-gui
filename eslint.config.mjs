// ESLint flat config enforcing strict JSDoc documentation on all TypeScript code.
// Mirrors the missing_docs = "deny" and missing_docs_in_private_items = "deny" from Rust/Clippy.

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    jsdoc.configs["flat/recommended-typescript-error"],
    {
        files: ["src/**/*.ts"],
        plugins: {
            jsdoc,
        },
        settings: {
            jsdoc: {
                mode: "typescript",
            },
        },
        rules: {
            // --- Documentation presence (equivalent to missing_docs = "deny") ---

            // Require JSDoc on all declarations: functions, classes, methods, arrows, etc.
            "jsdoc/require-jsdoc": ["error", {
                require: {
                    FunctionDeclaration: true,
                    MethodDefinition: true,
                    ClassDeclaration: true,
                    ArrowFunctionExpression: true,
                    FunctionExpression: true,
                },
                contexts: [
                    "TSInterfaceDeclaration",
                    "TSTypeAliasDeclaration",
                    "TSEnumDeclaration",
                    "TSEnumMember",
                    "TSPropertySignature",
                    "PropertyDefinition",
                    "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator",
                ],
                checkConstructors: true,
                checkGetters: true,
                checkSetters: true,
            }],

            // --- Documentation quality ---

            // Every JSDoc block must have a non-empty description.
            "jsdoc/require-description": "error",

            // Require @param tags for all function parameters.
            "jsdoc/require-param": "error",

            // Require descriptions on @param tags (not just the name).
            "jsdoc/require-param-description": "error",

            // Require @param type is not used (TypeScript provides types).
            "jsdoc/no-types": "error",

            // Require @returns tag on functions that return a value.
            "jsdoc/require-returns": "error",

            // Require description on @returns tag.
            "jsdoc/require-returns-description": "error",

            // --- Documentation correctness ---

            // Param names in JSDoc must match the actual function signature.
            "jsdoc/check-param-names": "error",

            // Tag names must be valid (no typos like @retuns).
            "jsdoc/check-tag-names": "error",

            // Enforce consistent alignment in JSDoc blocks.
            "jsdoc/check-alignment": "error",

            // Require that @param tags match actual params (no extras, no missing).
            "jsdoc/require-param-name": "error",

            // Check that @returns matches whether the function actually returns.
            "jsdoc/require-returns-check": "error",

            // Ensure descriptions are complete sentences (capital letter, period).
            "jsdoc/require-description-complete-sentence": "error",

            // Require a blank line between description and tags.
            "jsdoc/tag-lines": ["error", "any", { startLines: 1 }],
        },
    },
);
