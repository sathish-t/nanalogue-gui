// Tests that program names match package.json, where they are defined.

import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { GUI_APP_PROGRAM_NAME } from "./program-names";

// The CLI names need no test: tsc checks them against package.json "bin".
describe("program names", () => {
    it("match the package.json build.productName for the GUI", () => {
        expect(GUI_APP_PROGRAM_NAME).toBe(packageJson.build.productName);
    });
});
