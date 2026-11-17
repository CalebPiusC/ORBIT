#!/usr/bin/env python3
"""Boot the Orbit TUI in a pseudo-terminal, feed the bytes through a terminal emulator, and
write an HTML rendering of the final screen (plus a plain-text dump) for review.

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pyte
    /tmp/venv/bin/python script/screenshot-tui.py 110 32 /tmp/shots/home

The HTML file renders the frame with the exact colours the TUI emitted, which is the quickest way
to review a theme change without a browser in the sandbox."""
import fcntl
import html
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

import pyte

COLS, ROWS = int(sys.argv[1]) if len(sys.argv) > 1 else 110, int(sys.argv[2]) if len(sys.argv) > 2 else 32
OUT = sys.argv[3] if len(sys.argv) > 3 else "/tmp/shots/home"
CMD = ["bun", "run", "dev"]
CWD = "/home/user/ORBIT"
DURATION = float(os.environ.get("SHOT_SECONDS", "12"))

screen = pyte.Screen(COLS, ROWS)
stream = pyte.ByteStream(screen)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(CWD)
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    os.execvp(CMD[0], CMD)
    os._exit(1)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))

raw = bytearray()
deadline = time.time() + DURATION
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if fd in r:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        raw += chunk
        stream.feed(chunk)
        deadline = max(deadline, time.time() + 0.5)

os.kill(pid, signal.SIGTERM)
try:
    os.waitpid(pid, 0)
except OSError:
    pass

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
open(OUT + ".raw", "wb").write(bytes(raw))

# Plain text dump
lines = []
for y in range(ROWS):
    line = "".join(screen.buffer[y][x].data for x in range(COLS)).rstrip()
    lines.append(line)
text = "\n".join(lines).rstrip("\n")
open(OUT + ".txt", "w").write(text + "\n")
print(text)
print("---")


def color(value, default):
    if value is None or value == "default":
        return default
    if len(value) == 6:
        return "#" + value
    named = {
        "black": "#1c1c1c", "red": "#e05561", "green": "#8cc265", "yellow": "#d18f52",
        "blue": "#4aa5f0", "magenta": "#c162de", "cyan": "#42b3c2", "white": "#e6e6e6",
    }
    if value in named:
        return named[value]
    if value.startswith("brown"):
        return "#d18f52"
    return default


BG = "#0a0a0b"
FG = "#f5f5f5"
rows_html = []
for y in range(ROWS):
    line = []
    x = 0
    while x < COLS:
        ch = screen.buffer[y][x]
        fg = color(ch.fg, FG)
        bg = color(ch.bg, BG)
        if ch.reverse:
            fg, bg = bg, fg
        bold = bool(ch.bold)
        run = ""
        while x < COLS:
            cur = screen.buffer[y][x]
            cfg, cbg = color(cur.fg, FG), color(cur.bg, BG)
            if cur.reverse:
                cfg, cbg = cbg, cfg
            if (cfg, cbg, bool(cur.bold)) != (fg, bg, bold):
                break
            run += cur.data
            x += 1
        style = f"color:{fg};background-color:{bg}"
        if bold:
            style += ";font-weight:600"
        line.append(f'<span style="{style}">{html.escape(run)}</span>')
    rows_html.append('<div class="row">' + "".join(line) + "</div>")

page = f"""<!doctype html>
<meta charset="utf-8">
<title>Orbit TUI screenshot</title>
<style>
  body {{ margin: 0; background: #050506; color: {FG}; font-family: "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace; }}
  .term {{ display: inline-block; padding: 18px 20px; background: {BG}; border-radius: 10px; margin: 16px; }}
  .row {{ white-space: pre; font-size: 13px; line-height: 1.32; height: 1.32em; }}
</style>
<div class="term">
{chr(10).join(rows_html)}
</div>
"""
open(OUT + ".html", "w").write(page)
print(f"wrote {OUT}.html and {OUT}.txt")
