---
name: web-md
description: This skill should be used when the user asks to "convert this page to markdown", "convert this saved email/page to markdown", "get the article content", "extract this webpage as markdown", "save this page to Downloads as markdown", or otherwise wants the clean readable content of a webpage (usually login-gated, like email) turned into concise Markdown for an AI agent to consume. Runs fully locally on macOS via jsdom + Mozilla Readability + Turndown, with no cloud dependencies and no browser automation.
---

# web-md

Convert an HTML page the user has already saved to disk (e.g. Cmd+S from Chrome) into
clean, minimal-token Markdown: main content only, boilerplate stripped, headings/
paragraphs/lists/tables/code blocks/links preserved.

This only handles already-saved files, deliberately — see "Why file-only" below.

The heavy lifting is done by `scripts/extract.mjs`, a self-contained Node script that:
1. Reads the HTML file from disk and loads it into jsdom.
2. Strips scripts, styles, nav, ads, cookie banners, sidebars, social/share widgets,
   comments sections, and other boilerplate.
3. Resolves all links/images to absolute URLs, then runs Mozilla Readability to
   isolate the main content.
4. Converts the cleaned HTML to Markdown with Turndown (+ GFM tables/strikethrough).
   Every table converts to Markdown table syntax, even ones without a proper `<th>`
   heading row (the vast majority of real-world layout tables — email templates, app
   chrome) — Turndown's default behavior for those is to keep them as verbatim
   outerHTML, which is exactly the token bloat this skill exists to avoid.
5. Post-processes: collapses excess blank lines, drops duplicate blocks and
   image-only "badge" links, strips images by default, preserves fenced code blocks
   with language hints.
6. Prints the Markdown to stdout (for the calling agent) and optionally saves a `.md`
   file to `/Users/ali100/Downloads`.

## One-time setup

Dependencies are already installed in this skill's own directory (`node_modules`,
~26MB, no browser binaries needed). If `scripts/extract.mjs` ever fails with a
missing-module error, re-run setup:

```bash
cd /Users/ali100/.claude/skills/web-md
npm install
```

A shell alias is also set up in the user's `~/.zshrc`:
```bash
alias web2md='node ~/.claude/skills/web-md/scripts/extract.mjs'
```
so the user can run this directly in their own terminal without going through an
agent at all — always mention this as an option when it's relevant (e.g. the user
wants to minimize tokens, or wants a repeatable manual workflow).

## Usage

```bash
node /Users/ali100/.claude/skills/web-md/scripts/extract.mjs --file "<path>" [--source-url "<url>"] [--save] [--quiet]
```

The Markdown result is printed on stdout — read it directly from the Bash tool output
and use it as-is (already cleaned; do not re-summarize or re-process). Status/progress
messages go to stderr so stdout stays pure Markdown.

### Options

- `--file <path>` (required) — path to the saved HTML file.
- `--source-url <url>` — the page's real URL. Strongly recommended: without it,
  relative links in the page can't resolve to absolute URLs, and the output's
  `Source:` line falls back to a `file://` path. Ask the user for this (it's whatever
  was in their address bar) if they haven't given it.
- `--save` — write a `.md` file to `/Users/ali100/Downloads` (filename: slugified
  title + date) in addition to printing to stdout. The saved path is printed to
  stderr.
- `--quiet` — use with `--save` when the user only needs the file written, not the
  content read back into this conversation (e.g. they'll open it themselves, or feed
  it to another tool). Suppresses the Markdown on stdout entirely; only the `Saved:
  <path>` confirmation goes to stderr. Meaningfully cuts tokens on large pages, since
  otherwise the full converted Markdown is read back into context by default. Prefer
  this whenever the user's goal is "save it for me" rather than "show me" / "convert
  and use this."
- `--out <dir>` — change the save directory (default `/Users/ali100/Downloads`).
- `--keep-images` — keep image references in the Markdown (images are dropped by
  default to minimize tokens, since the target consumer is a coding agent, not a
  human reader).

## Workflow for the user

1. The user opens the page while logged in (email, internal tool, paywalled article)
   and saves it: `Cmd+S` in Chrome, keep the format as **"Webpage, HTML only"**. This
   produces a `.html` file (and sometimes a same-named `_files/` resource folder,
   which can be ignored — only the `.html` file is read).
2. Ask for (or infer, if unambiguous — e.g. only one recently modified `.html` file in
   Downloads) the saved file's path and, ideally, the page's real URL for
   `--source-url`.
3. Run the command above. Default to `--save`. Only add `--quiet` if the user
   indicated they don't need to see the content (they just want the file).

## Why file-only

Earlier versions of this skill also supported fetching a URL fresh (headless browser)
and reading an already-open Chrome tab live (via the Chrome DevTools Protocol). Both
were removed:

- **Fresh fetch** can't see anything behind a login, which covers most of what this
  skill gets used for (email, internal tools).
- **Live tab reading** requires Chrome running with `--remote-debugging-port` open.
  On managed/enterprise Chrome profiles (e.g. signed into a work or school Google
  Workspace account) this is commonly blocked by policy — confirmed on this machine
  via `lsof -iTCP:9222 -sTCP:LISTEN` / `curl localhost:9222/json/version` returning
  connection-refused even with the flag present and Chrome fully relaunched, while a
  throwaway non-default profile opened the port fine. That's not fixable by
  relaunching or by flags. Even where it does work, automating a user's real
  logged-in session is intrusive — some sites flag it as suspicious sign-in activity.

Saving the page manually first is the one approach that's reliable everywhere, needs
no automation of the user's live session, and has no policy dependency. If a future
session finds CDP genuinely usable (different machine, different profile), it would
need to be re-added rather than assumed to work.

## Known content-quality limits

- Designed for direct consumption by an AI coding agent, not for RAG/vector
  ingestion — output favors concision over exhaustive metadata.
- Headings, paragraphs, lists, tables, code blocks (with language hints when
  detectable), and links are preserved.
- Images, navigation, ads, cookie/consent banners, sidebars, social share widgets,
  comment sections, and exact-duplicate blocks are removed.
- A trailing `Source: <url>` line (plus byline/site name when Readability finds them)
  is appended so provenance isn't lost.
- If Readability cannot identify an article (e.g. dashboards, heavily interactive
  SPAs, full app-shell saves like a whole Gmail inbox view), it falls back to the
  cleaned full-body HTML. Nested layout tables (common in email templates and app
  UIs) convert to Markdown table syntax but can look rough — cells with block content
  or rowspan/colspan don't map cleanly to GFM tables. This is a real formatting
  limitation, not a bug to chase further: it trades perfect table fidelity for never
  falling back to raw HTML dumps, which is the right tradeoff for token efficiency.
- jsdom's CSS parser can throw on large/malformed generated stylesheets (seen on
  saved Gmail pages); `<style>` blocks are stripped from the raw HTML before parsing
  to avoid this — styling is discarded anyway since only text/structure is extracted.
