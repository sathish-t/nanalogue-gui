#!/usr/bin/env python3
"""Monitors MinKNOW sequencing status and manages llama-server lifecycle."""

import os
import subprocess
import time
import logging

from minknow_api import acquisition_pb2
from minknow_api.manager import Manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

HOME = os.path.expanduser("~")
LLAMA_BIN = os.path.join(HOME, "llama.cpp", "build", "bin", "llama-server")
LLAMA_CACHE = os.path.join(HOME, "llama.cpp", "cache")
LLAMA_CMD = [
    LLAMA_BIN,
    "-hf", "unsloth/Qwen3-Coder-Next-GGUF:UD-Q4_K_XL",
    "--jinja",
    "-ngl", "99",
    "-c", "262144",
    "-n", "8192",
    "-fa", "on",
    "-ts", "0.5,0.5",
    "-fit", "off",
    "--temp", "0.7",
    "--top-p", "0.80",
    "--top-k", "20",
     "--slot-save-path", LLAMA_CACHE,
    "--repeat-penalty", "1.05",
    "--host", "0.0.0.0",
    "--port", "12121",
]

LLAMA_LOG = os.path.join(HOME, "llama-server.log")

# How long after sequencing stops before we restart llama (seconds)
RESTART_DELAY_MINUTES = 20
COOLDOWN_FILE = "/tmp/llama-monitor-cooldown"

# Acquisition states that mean the GPU is needed for sequencing
ACTIVE_STATES = {
    acquisition_pb2.ACQUISITION_STARTING,
    acquisition_pb2.ACQUISITION_RUNNING,
    acquisition_pb2.ACQUISITION_FINISHING,
}


def is_sequencing() -> bool:
    """Check if any MinKNOW position is actively sequencing."""
    try:
        ca_cert_path = "/var/lib/minknow/data/rpc-certs/minknow/ca.crt"
        with open(ca_cert_path, "rb") as f:
            ca_cert = f.read()
        manager = Manager(port=9502, ca_certificate=ca_cert)
    except Exception as e:
        log.warning("Could not connect to MinKNOW manager: %s", e)
        # If we can't reach MinKNOW, assume not sequencing (don't block llama)
        return False

    for position in manager.flow_cell_positions():
        try:
            conn = position.connect()
            acquisition_info = conn.acquisition.get_acquisition_info()
            state = acquisition_info.state
            log.info("Position %s: state %s", position.name, state)

            if state in ACTIVE_STATES:
                return True
        except Exception as e:
            log.warning("Could not query position %s: %s", position.name, e)

    return False


def is_llama_running() -> bool:
    """Check if llama-server is running on port 20800."""
    result = subprocess.run(
        ["pgrep", "-f", "llama-server.*--port 20800"],
        capture_output=True,
    )
    return result.returncode == 0


def start_llama() -> None:
    """Start llama-server in the background."""
    log.info("Starting llama-server")
    with open(LLAMA_LOG, "a") as logfile:
        subprocess.Popen(
            LLAMA_CMD,
            stdout=logfile,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )


def stop_llama() -> None:
    """Stop llama-server with a 20-second graceful shutdown window."""
    log.info("Sending SIGTERM to llama-server")
    subprocess.run(["pkill", "-TERM", "-f", "llama-server.*--port 20800"])

    for _ in range(20):
        if not is_llama_running():
            log.info("llama-server stopped gracefully")
            return
        time.sleep(1)

    log.warning("llama-server did not stop in 20s, sending SIGKILL")
    subprocess.run(["pkill", "-KILL", "-f", "llama-server.*--port 20800"])


def set_cooldown() -> None:
    """Record the time sequencing stopped, for restart delay."""
    with open(COOLDOWN_FILE, "w") as f:
        f.write(str(time.time()))


def cooldown_elapsed() -> bool:
    """Check if enough time has passed since sequencing stopped."""
    if not os.path.exists(COOLDOWN_FILE):
        return True
    with open(COOLDOWN_FILE) as f:
        stopped_at = float(f.read().strip())
    elapsed = time.time() - stopped_at
    remaining = (RESTART_DELAY_MINUTES * 60) - elapsed
    if remaining > 0:
        log.info("Cooldown: %.0f minutes remaining", remaining / 60)
        return False
    return True


def clear_cooldown() -> None:
    """Remove the cooldown file."""
    if os.path.exists(COOLDOWN_FILE):
        os.remove(COOLDOWN_FILE)


def main() -> None:
    """Run once per cron invocation."""
    sequencing = is_sequencing()
    llama_running = is_llama_running()

    if sequencing:
        if llama_running:
            log.info("Sequencing active — stopping llama-server")
            stop_llama()
        else:
            log.info("Sequencing active — llama-server already stopped")
        set_cooldown()

    else:
        if llama_running:
            log.info("No sequencing — llama-server running")
            clear_cooldown()
        elif cooldown_elapsed():
            log.info("No sequencing, cooldown elapsed — starting llama-server")
            clear_cooldown()
            start_llama()
        # else: cooldown still active, logged in cooldown_elapsed()


if __name__ == "__main__":
    main()
