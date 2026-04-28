# claude-session-viewer

An interactive terminal UI for browsing and resuming [Claude Code](https://claude.ai/code) sessions across all your projects.

![claude-session-viewer demo](https://github.com/user-attachments/assets/placeholder)

## Features

- Browse all Claude Code sessions sorted by recency
- See a summary of what each session was about (first user message)
- Filter by project path or session content
- Hit **Enter** to copy the exact `claude --resume` command to your clipboard
- Configure specific project paths to focus on via a config file

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://claude.ai/code) CLI installed

## Usage

Run directly with `npx`:

```sh
npx tsx sessions.ts
```

Or clone and run:

```sh
git clone https://github.com/austinbrownapfm/claude-session-viewer
cd claude-session-viewer
npx tsx sessions.ts
```

Optional alias (bash/zsh):

```sh
echo "alias claude-sessions='npx tsx /path/to/sessions.ts'" >> ~/.zshrc
```

Fish shell:

```fish
echo "alias claude-sessions='npx tsx /path/to/sessions.ts'" >> ~/.config/fish/config.fish
```

### Watch specific paths

Pass `--watch` to filter to specific project directories:

```sh
npx tsx sessions.ts --watch ~/Desktop/code/myproject
```

### Personal config

Create `~/.claude/session-viewer.json` to set your default watch paths. Each entry can be a plain path string, or an object with an optional `name` field that sets the tab label:

```json
{
  "watchPaths": [
    "/Users/you/Desktop/code/myproject",
    { "path": "/Users/you/Desktop/code/myproject/backend", "name": "backend" },
    { "path": "/Users/you/Desktop/code/myproject/frontend", "name": "frontend" },
    { "path": "/Users/you", "name": "home" }
  ]
}
```

Without a `name`, the tab label is derived from the last segment of the path. Without a config file (or watch flags), all sessions across `~/.claude/projects/` are shown.

## Controls

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate sessions |
| `PgUp` `PgDn` | Page through results |
| `/` | Filter by project path or summary |
| `Enter` | Copy `claude --resume` command to clipboard |
| `r` | Reload sessions from disk |
| `q` / `Esc` | Quit |

## How it works

Claude Code stores session transcripts as `.jsonl` files in `~/.claude/projects/`, organized by project directory. This tool reads those files, extracts the first meaningful user message as a summary, and presents them in a navigable list sorted by recency.

Selecting a session copies the resume command to your clipboard:

```sh
cd '/path/to/project' && claude --resume <session-id>
```

## License

MIT
