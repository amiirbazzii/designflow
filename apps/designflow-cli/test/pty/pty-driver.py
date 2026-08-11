#!/usr/bin/env python3
"""PTY scenario driver for the DesignFlow product TUI acceptance tests.

Runs the *built* CLI inside a real pseudo-terminal, sends actual terminal
bytes, and asserts on the rendered screen. Prints `PASS <step>` / `FAIL <step>`
lines that the bun test harness asserts on, and exits non-zero on any FAIL.

Usage: pty-driver.py <scenario> <cli-entry.js>
Env:   DESIGNFLOW_HOME, DESIGNFLOW_AI_GATEWAY_URL/_TOKEN, FAKE_MCP_FIXTURES
       must be prepared by the caller (see tui-pty-acceptance.test.ts).
"""
import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import sys
import termios
import time

SCENARIO = sys.argv[1]
CLI = sys.argv[2]
PROJECT = os.environ["PTY_PROJECT_DIR"]

ENTER, ESC, DOWN, UP, TAB, CTRL_C = b"\r", b"\x1b", b"\x1b[B", b"\x1b[A", b"\t", b"\x03"

pid, master = pty.fork()
if pid == 0:
    os.chdir(PROJECT)
    os.execvpe("node", ["node", CLI], dict(os.environ))

os.set_blocking(master, False)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

buf = b""
failed = False


def read_for(seconds):
    global buf
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                return
            if not data:
                return
            buf += data


def screen():
    text = re.sub(rb"\x1b\[[0-9;?]*[a-zA-Z]", b"", buf)
    return re.sub(rb"\x1b[()][0-9A-B]", b"", text).decode("utf-8", "replace")


def alive():
    try:
        return os.waitpid(pid, os.WNOHANG) == (0, 0)
    except ChildProcessError:
        return False


def check(step, ok):
    global failed
    print(f"{'PASS' if ok else 'FAIL'} {step}", flush=True)
    if not ok:
        failed = True


def wait_for(marker, timeout=45):
    end = time.time() + timeout
    while time.time() < end:
        read_for(0.3)
        if marker in screen():
            return True
    return False


def expect(step, marker, timeout=20):
    check(step, wait_for(marker, timeout))


def send(data, settle=0.8):
    os.write(master, data)
    read_for(settle)


def journey_to_outcome(approval="first"):
    """Start screen → paste URL → destination → approval → run → outcome."""
    expect("startup", "DesignFlow", 60)
    send(ENTER, 1.5)
    expect("design-selection", "Select design")
    send(DOWN, 0.5)
    send(ENTER, 1.0)
    send(b"https://www.figma.com/design/AbCdEf123456/Test?node-id=1-2", 0.8)
    send(ENTER, 2.0)
    expect("destination", "estination", 20)
    send(ENTER, 1.5)
    if approval == "second":
        send(DOWN, 0.5)
    send(ENTER, 1.5)
    label = "DesignFlow handles approvals" if approval == "second" else "Review changes myself"
    check("approval-label", label in screen()[-2000:])
    send(ENTER, 1.0)  # start the run
    expect("needs-attention", "Needs attention", 90)
    read_for(2.0)


if SCENARIO in ("design-source-failure", "model-unreachable"):
    journey_to_outcome()
    if SCENARIO == "design-source-failure":
        check("failure-message", "retrieving the design source" in screen())
    if "View report" in screen()[-2500:]:
        send(DOWN, 0.6)  # move the outcome menu from View report to View details
    send(ENTER, 3.0)
    check("enter-opens-details", "Details" in screen()[-1600:])
    if SCENARIO == "design-source-failure":
        recent = screen()[-2500:]
        check("details-error-code", "Error code:" in recent)
        check("details-failed-step", "retrieve-figma-source-snapshot" in recent)
        check("details-problem", "Problem: " in recent)
        check("details-run-id", "Run id:" in recent)
        if os.environ.get("PTY_DEBUG") == "1":
            print("--- details screen ---")
            print(recent)
    send(ESC, 2.0)
    check("esc-returns-outcome", "Back to start" in screen()[-1600:])
    send(TAB, 1.0)   # outputs focus must not trap input
    send(UP, 0.5)
    send(DOWN, 0.5)  # arrows must not trap input
    send(ESC, 2.0)   # Esc at the outcome = Back to start
    check("back-to-start", "Start Design Engineer" in screen()[-2500:])
    send(ENTER, 2.0)
    check("new-run-startable", "Select design" in screen()[-2500:])
    send(ESC, 1.0)
    send(b"q", 1.0)
    for _ in range(40):
        if not alive():
            break
        time.sleep(0.25)
    check("q-quits", not alive())
elif SCENARIO == "proposal-review":
    # Journey to the manual-approval review (retrieval succeeds, the fake
    # gateway produces a valid two-file proposal), then prove the review and
    # diff views own their input — including after Tab moved sidebar focus.
    expect("startup", "DesignFlow", 60)
    send(ENTER, 1.5)
    expect("design-selection", "Select design")
    send(DOWN, 0.5)
    send(ENTER, 1.0)
    send(b"https://www.figma.com/design/AbCdEf123456/Test?node-id=1-2", 0.8)
    send(ENTER, 2.0)
    expect("destination", "estination", 20)
    send(ENTER, 1.5)
    send(ENTER, 1.5)  # approval: manual
    send(ENTER, 1.0)  # start the run
    expect("ready-to-apply", "Ready to apply", 240)
    read_for(2.0)
    check("checks-visible", "Build checked" in screen()[-2500:])
    send(TAB, 0.8)  # sidebar focus must not hijack the review
    send(TAB, 0.8)
    send(b"d", 2.0)  # advertised shortcut opens the diff even after Tab
    check("d-opens-diff", "Diff ·" in screen()[-5000:])
    check("diff-file-1", "1 of 2" in screen()[-5000:])
    send(b"]", 1.5)
    check("bracket-next-file", "2 of 2" in screen()[-5000:])
    send(b"]", 1.0)  # clamped at last file
    send(b"[", 1.5)
    check("bracket-previous-file", "1 of 2" in screen()[-5000:])
    send(b"j", 1.2)
    send(DOWN, 1.2)
    send(b"\x1b[6~", 1.2)  # PgDn
    check("diff-scrolls", "Showing" in screen()[-5000:])
    send(b"\x1b[H", 1.0)   # Home
    send(b"\x1b[F", 1.0)   # End
    check("home-end-alive", alive())
    send(ESC, 2.0)
    check("esc-returns-review", "View diff" in screen()[-2000:])
    send(DOWN, 0.8)
    check("apply-selectable", "› Apply" in screen()[-2000:])
    send(DOWN, 0.8)
    check("reject-selectable", "› Reject" in screen()[-2000:])
    send(ENTER, 4.0)
    ok = wait_for("No files were changed", 30)
    check("reject-no-mutation", ok)
    send(b"q", 1.0)
    for _ in range(40):
        if not alive():
            break
        time.sleep(0.25)
    check("q-quits", not alive())
elif SCENARIO == "ctrl-c":
    journey_to_outcome()
    send(CTRL_C, 1.0)
    for _ in range(40):
        if not alive():
            break
        time.sleep(0.25)
    check("ctrl-c-exits", not alive())
elif SCENARIO == "approval-designflow":
    journey_to_outcome(approval="second")
    send(b"q", 1.0)
    for _ in range(40):
        if not alive():
            break
        time.sleep(0.25)
    check("q-quits", not alive())
else:
    check(f"unknown-scenario-{SCENARIO}", False)

if alive():
    os.kill(pid, 15)
sys.exit(1 if failed else 0)
