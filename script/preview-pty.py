#!/usr/bin/env python3
"""Capture the screens the TUI cannot show by itself — the CLI's first-run prompt, for instance.

Boots the real command in a pseudo-terminal, emulates the screen with pyte, optionally types, and
writes the final screen as frame JSON (`{cols, rows, lines: [{spans: [...]}]}`) for
`packages/tui/script/preview-paint.ts` to paint. The fixture-driven screens use the same painter, so
the whole preview set looks the same.

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pyte
    /tmp/venv/bin/python script/preview-pty.py OUT --home /tmp/fresh --wait 14

    --send 18:\x18m        type a key sequence once that many seconds have passed (\x18 is ctrl+x)
    --record DIR           also write frame-0000.frame.json ... every --every seconds
"""

import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

import pyte

ap = argparse.ArgumentParser()
ap.add_argument("out", help="frame path, without extension")
ap.add_argument("--cols", type=int, default=100)
ap.add_argument("--rows", type=int, default=30)
ap.add_argument("--wait", type=float, default=14.0)
ap.add_argument("--send", action="append", default=[])
ap.add_argument("--home", default=None, help="HOME for the run; a fresh one shows first-run")
ap.add_argument("--cmd", default="bun run dev --standalone")
ap.add_argument("--cwd", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap.add_argument("--record", default=None, help="directory for a frame sequence")
ap.add_argument("--every", type=float, default=0.5, help="seconds between recorded frames")
args = ap.parse_args()

NAMES = {
    "black": "1c1c1c",
    "red": "e05561",
    "green": "8cc265",
    "yellow": "d18f52",
    "blue": "4aa5f0",
    "magenta": "c162de",
    "cyan": "42b3c2",
    "white": "e6e6e6",
}
DEFAULT_FG, DEFAULT_BG = "f5f5f5", "0a0a0b"


def rgb(value, fallback):
    if value is None or value == "default":
        value = fallback
    if value.startswith("#"):
        value = value[1:]
    elif len(value) != 6:
        value = NAMES.get(value.split()[0], fallback)
    return {"r": int(value[0:2], 16), "g": int(value[2:4], 16), "b": int(value[4:6], 16), "a": 255}


send = []
for item in args.send:
    at, _, text = item.partition(":")
    send.append((float(at), text.encode().decode("unicode_escape").encode("latin-1")))
send.sort()

# Inherit the caller's environment (the preview runs set a placeholder key so onboarding is skipped),
# then pin the terminal description and, if asked, a private home.
env = dict(os.environ)
env.update(
    {
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "LANG": "C.UTF-8",
        "HOME": args.home or os.environ.get("HOME", "/root"),
        "SHELL": "/bin/bash",
    }
)
if args.home:
    for name in ("data", "config", "cache", "state"):
        env["XDG_" + name.upper() + "_HOME"] = os.path.join(args.home, name)

screen = pyte.Screen(args.cols, args.rows)
stream = pyte.ByteStream(screen)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(args.cwd)
    os.execvpe("/bin/sh", ["/bin/sh", "-c", args.cmd], env)
    os._exit(1)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))


def capture():
    lines = []
    for y in range(args.rows):
        spans = []
        x = 0
        while x < args.cols:
            cell = screen.buffer[y][x]
            fg = rgb(cell.fg, DEFAULT_FG)
            bg = rgb(cell.bg, DEFAULT_BG)
            if cell.reverse:
                fg, bg = bg, fg
            bold = bool(cell.bold)
            text = ""
            start = x
            while x < args.cols:
                cur = screen.buffer[y][x]
                cur_fg = rgb(cur.fg, DEFAULT_FG)
                cur_bg = rgb(cur.bg, DEFAULT_BG)
                if cur.reverse:
                    cur_fg, cur_bg = cur_bg, cur_fg
                if (cur_fg, cur_bg, bool(cur.bold)) != (fg, bg, bold):
                    break
                text += cur.data
                x += 1
            spans.append({"text": text, "fg": fg, "bg": bg, "attributes": 1 if bold else 0, "width": x - start})
        lines.append({"spans": spans})
    return lines


def scrub(lines):
    """`bun run` echoes the command above the app; that line is the harness, not Orbit."""
    for line in lines:
        text = "".join(span["text"] for span in line["spans"])
        if not text.strip():
            continue
        if text.startswith("$ "):
            line["spans"] = [
                {
                    "text": " " * args.cols,
                    "fg": rgb(DEFAULT_FG, DEFAULT_FG),
                    "bg": rgb(DEFAULT_BG, DEFAULT_BG),
                    "attributes": 0,
                    "width": args.cols,
                }
            ]
        break
    return lines


def write(path, lines):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path + ".frame.json", "w") as handle:
        json.dump({"cols": args.cols, "rows": args.rows, "lines": scrub(lines)}, handle)


started = time.time()
pending = list(send)
deadline = started + args.wait
next_frame = started
recorded = 0
while time.time() < deadline:
    now = time.time()
    while pending and pending[0][0] <= now - started:
        os.write(fd, pending.pop(0)[1])
        deadline = max(deadline, time.time() + 4)
    if args.record and now >= next_frame and now > started + 1.5:
        write(os.path.join(args.record, f"frame-{recorded:04d}"), capture())
        recorded += 1
        next_frame = now + args.every
    readable, _, _ = select.select([fd], [], [], 0.1)
    if fd in readable:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        stream.feed(chunk)

try:
    os.kill(pid, signal.SIGTERM)
    os.waitpid(pid, 0)
except OSError:
    pass

write(args.out, capture())
print(f"wrote {args.out}.frame.json" + (f" and {recorded} recorded frames" if args.record else ""), file=sys.stderr)
