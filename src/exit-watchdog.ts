// Watchdog child process that force-kills the parent on demand.
// Receives "kill" messages from the main process and sends SIGKILL.

const parentPid = parseInt(process.argv[2], 10);

process.on("message", (msg: unknown) => {
    if (msg === "kill") {
        try {
            process.kill(parentPid, "SIGKILL");
        } catch {
            // Parent already exited
        }
        process.exit(0);
    }
});

// If the IPC channel disconnects (parent crashed or exited), clean up
process.on("disconnect", () => {
    process.exit(0);
});
