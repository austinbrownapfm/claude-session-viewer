#!/usr/bin/env npx tsx
/**
 * Claude Code Session Viewer
 *
 * Usage:
 *   npx tsx sessions.ts [--watch <path>...]
 *
 * Default watch paths are loaded from ~/.claude/session-viewer.json:
 *   { "watchPaths": ["/your/project/path", ...] }
 *
 * If no config exists, all sessions across ~/.claude/projects/ are shown.
 *
 * Controls:
 *   ↑↓         Navigate sessions
 *   PgUp/PgDn  Page through results
 *   /          Filter by project or summary text
 *   Enter      Copy resume command to clipboard
 *   r          Reload sessions from disk
 *   q / Esc    Quit
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";

// ── Config ──────────────────────────────────────────────────────────────────

const HOME = process.env.HOME!;
const PROJECTS_ROOT = path.join(HOME, ".claude", "projects");
const CONFIG_FILE = path.join(HOME, ".claude", "session-viewer.json");
const PAGE_SIZE = 15;
const SUMMARY_LENGTH = 90;

interface Config {
  watchPaths?: string[];
}

function loadConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

// CLI --watch flags take priority; fall back to config; fall back to scan all
const cliWatchPaths: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--watch" && process.argv[i + 1]) {
    cliWatchPaths.push(process.argv[++i]);
  }
}

const config = loadConfig();
const configWatchPaths: string[] = config.watchPaths ?? [];
const watchPaths: string[] = [...new Set([...cliWatchPaths, ...configWatchPaths])];

// If no paths configured, fall back to showing all projects
const SCAN_ALL = watchPaths.length === 0;

// ── Types ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  projectPath: string;
  file: string;
  mtime: Date;
  sizeMB: number;
  summary: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an absolute project path to its ~/.claude/projects/ directory name.
 *  Claude Code encodes paths by replacing all non-alphanumeric chars with "-". */
function pathToProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Reverse: decode a ~/.claude/projects/ dir name back to a best-guess path.
 *  This is lossy (any non-alphanumeric char becomes "-") but good enough for display. */
function projectDirNameToPath(dirName: string): string {
  // Leading "-" → leading "/"
  return dirName.replace(/-/g, "/").replace(/^\//, "/");
}

function extractSummary(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "user") continue;
        const msg = obj.message;
        if (!msg) continue;

        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              text = block.text;
              break;
            }
          }
        }

        if (text.startsWith("<") || text.startsWith("/")) continue;
        text = text.replace(/\s+/g, " ").trim();
        if (text.length < 5) continue;

        return text.length > SUMMARY_LENGTH
          ? text.slice(0, SUMMARY_LENGTH) + "…"
          : text;
      } catch {
        continue;
      }
    }
  } catch {
    // unreadable
  }
  return "(no summary)";
}

function loadSessions(): Session[] {
  const sessions: Session[] = [];
  const seen = new Set<string>();

  const scanProjectDir = (projectDir: string, projectPath: string) => {
    let files: string[];
    try {
      files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return;
    }

    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);

      const fullPath = path.join(projectDir, file);
      try {
        const stat = fs.statSync(fullPath);
        sessions.push({
          id: file.replace(".jsonl", ""),
          projectPath,
          file: fullPath,
          mtime: stat.mtime,
          sizeMB: stat.size / 1_000_000,
          summary: extractSummary(fullPath),
        });
      } catch {
        continue;
      }
    }
  };

  if (SCAN_ALL) {
    // No config — show everything
    try {
      for (const dirName of fs.readdirSync(PROJECTS_ROOT)) {
        const projectDir = path.join(PROJECTS_ROOT, dirName);
        if (!fs.statSync(projectDir).isDirectory()) continue;
        scanProjectDir(projectDir, projectDirNameToPath(dirName));
      }
    } catch {
      // projects root missing
    }
  } else {
    // Scan only configured paths
    for (const p of watchPaths) {
      const dirName = pathToProjectDirName(p);
      scanProjectDir(path.join(PROJECTS_ROOT, dirName), p);
    }
  }

  return sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// ── UI ───────────────────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const CYAN   = "\x1b[36m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BG_SEL = "\x1b[48;5;236m";
const CLEAR  = "\x1b[2J\x1b[H";

function formatAge(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  60) return `${mins}m ago`;
  if (hours <  24) return `${hours}h ago`;
  if (days  <   7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortProject(p: string): string {
  const normalized = p.replace(/^\/Users\/[^/]+/, "~");
  const parts = normalized.split("/");
  return parts.slice(-2).join("/");
}

function renderHeader(total: number, page: number, pages: number, filter: string, scanAll: boolean) {
  const cols = process.stdout.columns || 100;
  const mode = scanAll ? `${DIM}(all projects)${RESET}` : `${DIM}(configured paths)${RESET}`;
  process.stdout.write(
    `${BOLD}${CYAN} Claude Sessions${RESET}  ` +
    `${DIM}${total} sessions · page ${page + 1}/${pages}${RESET}  ${mode}` +
    (filter ? `  ${YELLOW}filter: ${filter}${RESET}` : "") +
    "\n" +
    `${DIM}${"─".repeat(cols)}${RESET}\n`
  );
}

function renderRow(s: Session, selected: boolean) {
  const prefix = selected ? `${BG_SEL}${BOLD}${GREEN} ▶ ${RESET}${BG_SEL}` : `   `;
  const suffix = selected ? RESET : "";

  const age     = formatAge(s.mtime).padEnd(8);
  const proj    = shortProject(s.projectPath).padEnd(32);
  const size    = `${s.sizeMB.toFixed(1)}MB`.padStart(7);
  const idShort = s.id.slice(0, 8);

  const meta    = `${DIM}${age} ${proj} ${size} ${idShort}${RESET}`;
  const summary = selected ? `${BOLD}${s.summary}${RESET}` : `${DIM}${s.summary}${RESET}`;

  process.stdout.write(`${prefix}${meta}${suffix}\n`);
  process.stdout.write(`${prefix}   ${summary}${suffix}\n`);
}

function renderFooter(selected: Session | null, message: string) {
  const cols = process.stdout.columns || 100;
  process.stdout.write(`${DIM}${"─".repeat(cols)}${RESET}\n`);
  if (selected) {
    const cmd = `cd '${selected.projectPath}' && claude --resume ${selected.id}`;
    process.stdout.write(`${BOLD}${GREEN}Resume:${RESET} ${cmd}\n`);
  } else {
    process.stdout.write("\n");
  }
  process.stdout.write(
    `${DIM}↑↓ navigate · PgUp/PgDn page · / filter · Enter copy · r reload · q quit${RESET}\n`
  );
  if (message) {
    process.stdout.write(`\n${YELLOW}${message}${RESET}\n`);
  }
}

function copyToClipboard(text: string): boolean {
  try {
    // macOS
    execSync(`echo ${JSON.stringify(text)} | pbcopy`);
    return true;
  } catch {}
  try {
    // Linux (xclip)
    execSync(`echo ${JSON.stringify(text)} | xclip -selection clipboard`);
    return true;
  } catch {}
  try {
    // Linux (xsel)
    execSync(`echo ${JSON.stringify(text)} | xsel --clipboard --input`);
    return true;
  } catch {}
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let sessions  = loadSessions();
  let filter    = "";
  let cursor    = 0;
  let page      = 0;
  let mode: "browse" | "filter" = "browse";
  let message   = "";

  const getFiltered = () =>
    filter
      ? sessions.filter(
          (s) =>
            s.summary.toLowerCase().includes(filter.toLowerCase()) ||
            s.projectPath.toLowerCase().includes(filter.toLowerCase())
        )
      : sessions;

  const render = () => {
    const filtered = getFiltered();
    const pages    = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page           = Math.min(page, pages - 1);
    const visible  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    cursor         = Math.min(cursor, Math.max(0, visible.length - 1));

    process.stdout.write(CLEAR);
    renderHeader(filtered.length, page, pages, filter, SCAN_ALL);
    visible.forEach((s, i) => renderRow(s, i === cursor));

    // Stable height
    for (let i = visible.length; i < PAGE_SIZE; i++) process.stdout.write("\n\n");

    renderFooter(visible[cursor] ?? null, message);
    message = "";
  };

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  render();

  process.stdin.on("keypress", (str, key) => {
    if (mode === "filter") {
      if (key.name === "escape" || key.name === "return") {
        mode = "browse";
        cursor = 0;
        page = 0;
      } else if (key.name === "backspace") {
        filter = filter.slice(0, -1);
      } else if (str && !key.ctrl && !key.meta) {
        filter += str;
      }
      render();
      return;
    }

    const filtered = getFiltered();
    const pages    = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const visible  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if ((key.ctrl && key.name === "c") || key.name === "q") {
      process.stdout.write(RESET + "\n");
      process.exit(0);
    } else if (key.name === "escape") {
      filter = "";
      cursor = 0;
      page   = 0;
    } else if (str === "/" || key.name === "slash") {
      mode   = "filter";
      filter = "";
    } else if (key.name === "r") {
      sessions = loadSessions();
      cursor   = 0;
      page     = 0;
      message  = "Reloaded.";
    } else if (key.name === "up") {
      if (cursor > 0) cursor--;
      else if (page > 0) { page--; cursor = PAGE_SIZE - 1; }
    } else if (key.name === "down") {
      if (cursor < visible.length - 1) cursor++;
      else if (page < pages - 1) { page++; cursor = 0; }
    } else if (key.name === "pageup") {
      page   = Math.max(0, page - 1);
      cursor = 0;
    } else if (key.name === "pagedown") {
      page   = Math.min(pages - 1, page + 1);
      cursor = 0;
    } else if (key.name === "return") {
      const sel = visible[cursor];
      if (sel) {
        const cmd = `cd '${sel.projectPath}' && claude --resume ${sel.id}`;
        message = copyToClipboard(cmd)
          ? `Copied: ${cmd}`
          : `Resume: ${cmd}`;
      }
    }

    render();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
