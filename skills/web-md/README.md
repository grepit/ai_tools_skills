# web-md

Convert a saved HTML page into clean, minimal-token Markdown — built for feeding
page content to an AI agent, not for humans or RAG/vector ingestion.

Runs entirely locally on macOS. No browser automation, no cloud API calls, no
network access at runtime.

## Why

Most "page to Markdown" tools either:

- fetch the URL fresh, which can't see anything behind a login (email, internal
  tools, paywalled articles), or
- automate a live, logged-in browser tab, which is intrusive (some sites flag it as
  suspicious sign-in activity) and, on managed/enterprise Chrome profiles, is often
  blocked outright by policy regardless of what flags you pass.

web-md sidesteps both: the user saves the page themselves while already logged in
(`Cmd+S` → "Webpage, HTML only"), and this tool converts that saved file. No
automation of any live session, no policy dependency, works everywhere.

It also fixes a subtler problem: most Markdown converters only convert tables that
have a proper `<th>` heading row. Virtually no real-world layout table does — email
templates and app UI chrome are built almost entirely from headerless `<table>`
elements — so the "clean" conversion silently falls back to dumping the entire table
as raw HTML, attributes included. That defeats the point of converting to Markdown at
all if the goal is minimizing tokens. web-md forces every table through Markdown
table syntax instead.

## Install

```bash
git clone <this-repo> web-md
cd web-md
npm install
```

No browser binaries are downloaded — the pipeline is pure Node (jsdom + Readability +
Turndown), so setup is fast and the footprint is small (~26MB).

## Usage

1. Save the page: open it in your browser (already logged in, if needed), then
   `Cmd+S` → keep the format as **"Webpage, HTML only"**.
2. Convert it:

```bash
node scripts/extract.mjs --file path/to/saved-page.html --source-url "https://original.url/of/the/page" --save
```

Markdown prints to stdout by default; status messages go to stderr, so stdout stays
pipeable/redirectable:

```bash
node scripts/extract.mjs --file page.html > page.md
```

### Options

| Flag | Description |
|---|---|
| `--file <path>` | **Required.** Path to the saved HTML file. |
| `--source-url <url>` | The page's real URL. Recommended — without it, relative links can't resolve to absolute URLs, and the output falls back to a `file://` source. |
| `--save` | Also write a `.md` file (slugified title + date) to `~/Downloads`. |
| `--out <dir>` | Change the save directory. |
| `--quiet` | With `--save`: suppress the Markdown on stdout, only report the saved path. Use when you just want the file, not the content printed. |
| `--keep-images` | Keep image references (dropped by default — the target reader is a coding agent, not a human). |

### Shortcut

```bash
alias web2md='node /path/to/web-md/scripts/extract.mjs'
```

```bash
web2md --file ~/Downloads/some-email.html --save
```

## How it works

1. Read the saved HTML file, strip `<style>` blocks before parsing (jsdom's bundled
   CSS parser can throw on large/malformed generated stylesheets — common in saved
   Gmail pages — and styling is discarded anyway).
2. Load into jsdom; strip scripts, nav, ads, cookie banners, sidebars, social/share
   widgets, comment sections, and similar boilerplate by tag and by a class/id
   keyword pattern.
3. Resolve every link and image to an absolute URL (needed because the raw
   `href`/`src` attributes turndown reads may be page-relative, and won't mean
   anything once the Markdown leaves the page's context).
4. Run [Mozilla Readability](https://github.com/mozilla/readability) to isolate the
   main content. Falls back to the cleaned full body if Readability can't identify an
   article (dashboards, heavily interactive SPAs).
5. Convert to Markdown with [Turndown](https://github.com/mixmark-io/turndown) + the
   GFM plugin (tables, strikethrough), with every table forced through Markdown table
   syntax rather than the plugin's default raw-HTML fallback for headerless tables.
6. Post-process: collapse excess blank lines, drop exact-duplicate blocks and
   image-only "badge" links, tighten list-marker spacing, strip images by default.

## Known limitations

- Table fidelity is traded for token efficiency: nested layout tables (rowspan,
  colspan, block content in cells — common in email templates and app UIs) convert to
  Markdown table syntax but can look rough. That's a deliberate tradeoff, not a bug —
  the alternative is falling back to raw HTML, which is worse for the intended use
  case (feeding an AI agent).
- Only handles content already present in the saved HTML at save time — nothing
  dynamically loaded after that point (infinite-scroll feeds, lazy content) will be
  present.
- No `--url`/live-tab modes. See "Why" above.

## License

Add a license before publishing publicly if you intend others to reuse this.
