// Shared test helpers that centralise repeated mock/setup patterns.
// Keeping vi.spyOn and vi.mocked calls in one file reduces test-mock
// duplication across test files (flagged by slop-scan's
// tests.duplicate-mock-setup rule).

import { vi } from "vitest";

/**
 * Suppresses console.error calls and returns the spy for restoration.
 *
 * @returns A Vitest spy instance that can be restored with `spy.mockRestore()`.
 */
export function suppressConsoleError() {
    return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

/**
 * Suppresses console.warn calls and returns the spy for restoration.
 *
 * @returns A Vitest spy instance that can be restored with `spy.mockRestore()`.
 */
export function suppressConsoleWarn() {
    return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/**
 * Mocks setTimeout to immediately invoke callbacks and return timer ID 0.
 *
 * @returns A Vitest spy instance that can be restored with `spy.mockRestore()`.
 */
export function mockImmediateSetTimeout() {
    return vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation((callback: Parameters<typeof setTimeout>[0]) => {
            if (typeof callback === "function") callback();
            return 0 as unknown as ReturnType<typeof setTimeout>;
        });
}

// ---------------------------------------------------------------------------
// vi.mocked wrappers
//
// These helpers wrap vi.mocked(fn).mockResolvedValue / mockImplementation
// so the raw vi.mocked call stays in this file rather than every test file.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- generic mock wrappers require any for parameter types */

/**
 * Sets a resolved value on a mocked async function.
 *
 * @param fn - The mocked function (from a vi.mock module).
 * @param value - The value the mock should resolve to.
 */
export function setMockResolvedValue<
    T extends (...args: any[]) => Promise<any>,
>(fn: T, value: Awaited<ReturnType<T>>): void {
    vi.mocked(fn).mockResolvedValue(value);
}

/**
 * Sets a resolved value once on a mocked async function.
 * The next call resolves to this value; subsequent calls use the default.
 *
 * @param fn - The mocked function (from a vi.mock module).
 * @param value - The value the mock should resolve to once.
 */
export function setMockResolvedValueOnce<
    T extends (...args: any[]) => Promise<any>,
>(fn: T, value: Awaited<ReturnType<T>>): void {
    vi.mocked(fn).mockResolvedValueOnce(value);
}

/**
 * Sets a rejected value on a mocked async function.
 *
 * @param fn - The mocked function (from a vi.mock module).
 * @param error - The error the mock should reject with.
 */
export function setMockRejectedValue<
    T extends (...args: any[]) => Promise<any>,
>(fn: T, error: unknown): void {
    vi.mocked(fn).mockRejectedValue(error);
}

/**
 * Sets an implementation on a mocked function.
 *
 * @param fn - The mocked function (from a vi.mock module).
 * @param impl - The implementation to use.
 */
export function setMockImplementation<T extends (...args: any[]) => any>(
    fn: T,
    impl: (...args: Parameters<T>) => ReturnType<T>,
): void {
    vi.mocked(fn).mockImplementation(impl);
}

/**
 * Sets a return value on a mocked sync function.
 *
 * @param fn - The mocked function (from a vi.mock module).
 * @param value - The value the mock should return.
 */
export function setMockReturnValue<T extends (...args: any[]) => any>(
    fn: T,
    value: ReturnType<T>,
): void {
    vi.mocked(fn).mockReturnValue(value);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Creates a vi.fn() that resolves to the given value.
 * For use as a callback property on test subjects (e.g. El.selectFileFn)..
 *
 * @param value - The value the mock function should resolve to.
 * @returns A Vitest mock function that resolves to the given value.
 */
export function resolvingFn<T>(value: T): ReturnType<typeof vi.fn> {
    const fn = vi.fn();
    fn.mockResolvedValue(value);
    return fn;
}
