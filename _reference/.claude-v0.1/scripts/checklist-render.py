#!/usr/bin/env python3
"""TUI renderer for HiNAS checklist — runs in 2nd Terminal window.

Reads:
  .claude/always-on-rules.md         — '## ' headings = rule names
  .claude/figma-migrate-checklist.md — '- [ ] ...'    = workflow items (when migrate mode on)
  .claude/state/migrate-mode.flag    — 'on' | 'off'
  .claude/state/rule-status.tsv      — key<TAB>status<TAB>timestamp lines

Polls every 200ms and redraws.
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])
ALWAYS_ON = PROJECT_ROOT / ".claude/always-on-rules.md"
MIGRATE_CL = PROJECT_ROOT / ".claude/figma-migrate-checklist.md"
STATE_DIR = PROJECT_ROOT / ".claude/state"
FLAG = STATE_DIR / "migrate-mode.flag"
STATUS_FILE = STATE_DIR / "rule-status.tsv"

GRAY = "\033[90m"
YELLOW = "\033[33m"
GREEN = "\033[32m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"
ENTER_ALT = "\033[?1049h"  # switch to alternate screen buffer (no scrollback)
EXIT_ALT = "\033[?1049l"   # restore main screen on exit
HOME_CLEAR = "\033[H\033[2J"  # cursor home + clear (used inside alt buffer)

SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
DONE_FADE_SEC = 3
STUCK_RUNNING_SEC = 600  # 10 min — covers slow DS syncs and HTML parses


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def parse_rules() -> list[str]:
    if not ALWAYS_ON.exists():
        return []
    out = []
    for line in ALWAYS_ON.read_text().splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            out.append(m.group(1))
    return out


def parse_workflow() -> list[tuple[str, str]]:
    """Return list of (section, label) for `- [ ]` items in figma-migrate-checklist.md."""
    if not MIGRATE_CL.exists():
        return []
    items: list[tuple[str, str]] = []
    section = ""
    for line in MIGRATE_CL.read_text().splitlines():
        sec = re.match(r"^##\s+(.+?)\s*$", line)
        if sec:
            section = sec.group(1)
            continue
        m = re.match(r"^\s*-\s*\[\s*\]\s*(.+?)\s*$", line)
        if not m:
            continue
        raw = m.group(1)
        # If line starts with **bold**, use that as the label
        bm = re.match(r"^\*\*([^*]+)\*\*\s*(.*)$", raw)
        if bm:
            label = bm.group(1).strip()
            rest = bm.group(2)
            # Disambiguate duplicates by appending leading parenthetical
            paren = re.match(r"^\(([^)]+)\)", rest)
            if paren:
                label = f"{label} ({paren.group(1)})"
        else:
            # Otherwise split only on real separators (with surrounding spaces) to avoid backticks
            parts = re.split(r"\s+—\s+|\s+→\s+|\s+=\s+", raw, 1)
            label = parts[0].strip()
        # truncate runaway labels
        if len(label) > 60:
            label = label[:57] + "..."
        items.append((section, label))
    return items


def read_status() -> dict[str, tuple[str, int]]:
    """Return {key: (status, ts)} from the last row per key."""
    if not STATUS_FILE.exists():
        return {}
    out: dict[str, tuple[str, int]] = {}
    for line in STATUS_FILE.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        key, status, ts_s = parts
        try:
            out[key] = (status, int(ts_s))
        except ValueError:
            continue
    return out


def read_flag() -> str:
    if not FLAG.exists():
        return "off"
    return FLAG.read_text().strip() or "off"


def status_for(key: str, statuses: dict[str, tuple[str, int]], now: int, *, fade_done: bool) -> str:
    entry = statuses.get(key)
    if not entry:
        return "idle"
    status, ts = entry
    age = now - ts
    if status == "running" and age > STUCK_RUNNING_SEC:
        return "idle"
    if fade_done and status == "done" and age > DONE_FADE_SEC:
        return "idle"
    return status


def icon_for(status: str, frame: int) -> str:
    if status == "running":
        return f"{YELLOW}{SPINNER[frame % len(SPINNER)]}{RESET}"
    if status == "done":
        return f"{GREEN}✅{RESET}"
    return f"{GRAY}☐{RESET}"


def label_color(status: str) -> tuple[str, str]:
    if status == "idle":
        return DIM, RESET
    return "", RESET


def draw(frame: int) -> None:
    now = int(time.time())
    statuses = read_status()
    flag = read_flag()
    rules = parse_rules()

    out: list[str] = [HOME_CLEAR]
    ts = datetime.now().strftime("%H:%M:%S")
    out.append(f"{BOLD}HiNAS Checklist{RESET}{DIM}        live · {ts}{RESET}\n\n")

    out.append(f"{BOLD}{GRAY}ALWAYS-ON RULES{RESET}\n")
    if not rules:
        out.append(f"  {DIM}(no rules — check .claude/always-on-rules.md){RESET}\n")
    for rule in rules:
        key = slugify(rule)
        st = status_for(key, statuses, now, fade_done=True)
        pre, post = label_color(st)
        out.append(f"  {icon_for(st, frame)}  {pre}{rule}{post}\n")

    if flag == "on":
        items = parse_workflow()
        out.append(f"\n{BOLD}{GRAY}/figma-migrate WORKFLOW{RESET}\n")
        last_section = None
        for section, label in items:
            if section != last_section:
                short = re.sub(r"\s*—.*$", "", section).strip()
                short = re.sub(r"\s*\(.*$", "", short).strip()
                out.append(f"  {DIM}{short}{RESET}\n")
                last_section = section
            key = slugify(label)
            # workflow done state stays solid (no fade)
            st = status_for(key, statuses, now, fade_done=False)
            pre, post = label_color(st)
            out.append(f"    {icon_for(st, frame)}  {pre}{label}{post}\n")

    out.append(f"\n{DIM}(Ctrl+C to exit){RESET}\n")
    sys.stdout.write("".join(out))
    sys.stdout.flush()


def main() -> None:
    frame = 0
    try:
        # Wipe main-screen scrollback + visible content, then enter alt screen.
        # \033[3J clears scrollback (xterm), \033[2J clears visible screen,
        # \033[H homes the cursor, \033[?1049h enters alt screen, \033[?25l hides cursor.
        sys.stdout.write("\033[3J\033[2J\033[H" + ENTER_ALT + "\033[?25l")
        sys.stdout.flush()
        while True:
            draw(frame)
            frame += 1
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        # restore cursor + leave alternate screen buffer
        sys.stdout.write("\033[?25h" + EXIT_ALT)
        sys.stdout.flush()


if __name__ == "__main__":
    main()
