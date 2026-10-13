// Watchdog utility process that force-kills the parent after an arm/ack handshake.

const parentPid = parseInt(process.argv[2], 10);
const parentPort = process.parentPort;

/** Independent exit deadline once a close request reaches the watchdog. */
const WATCHDOG_KILL_DELAY_MS = 250;

/** Kills the parent even if its event loop can no longer process the acknowledgement. */
function killParent(): void {
    try {
        process.kill(parentPid, "SIGKILL");
    } catch {
        // Parent already exited
    }
    process.exit(0);
}

parentPort?.on("message", (event) => {
    if (event.data === "arm-exit-watchdog") {
        setTimeout(killParent, WATCHDOG_KILL_DELAY_MS);
        parentPort.postMessage("exit-watchdog-armed");
    } else if (event.data === "kill-parent") {
        killParent();
    }
});
