#!/usr/bin/env node
// web-md: convert an already-saved HTML page (e.g. Cmd+S from Chrome) to clean,
// minimal-token Markdown. Strips boilerplate, runs Mozilla Readability to isolate
// the main content, converts to Markdown with Turndown.
//
// Usage:
//   node extract.mjs --file <path> [--source-url <url>] [--save] [--out <dir>] [--keep-images] [--quiet]
//
// Markdown is printed on stdout. Status / diagnostic messages go to stderr,
// so stdout is always clean, pasteable Markdown.

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DOWNLOADS = '/Users/ali100/Downloads';

function parseArgs(argv) {
  const opts = {
    file: null,
    sourceUrl: null,
    save: false,
    out: DEFAULT_DOWNLOADS,
    keepImages: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--file': opts.file = argv[++i]; break;
      case '--source-url': opts.sourceUrl = argv[++i]; break;
      case '--save': opts.save = true; break;
      case '--out': opts.out = argv[++i]; break;
      case '--keep-images': opts.keepImages = true; break;
      case '--quiet': opts.quiet = true; break;
      default:
        if (!opts.file && !a.startsWith('--')) opts.file = a;
    }
  }
  if (opts.quiet && !opts.save) {
    log('--quiet has no effect without --save (there would be nothing to report).');
  }
  return opts;
}

function log(...args) { console.error(...args); }

// ---------- boilerplate removal ----------

function stripBoilerplate(document) {
  const KILL_TAGS = new Set([
    'script', 'style', 'noscript', 'iframe', 'svg', 'template', 'form',
    'button', 'link', 'input', 'select', 'textarea', 'video', 'audio',
    'canvas', 'embed', 'object',
  ]);
  const KILL_RE = /\b(nav(bar)?|menu|sidebar|advert(isement)?s?|\bad\b|ads-|banner|cookie|consent|gdpr|subscribe|newsletter|social[-_]?share|share[-_]?buttons?|comments?|related[-_]?(posts?|articles?)|popup|modal|breadcrumbs?|masthead|site-header|site-footer|promo|paywall|widget|skip-link|toolbar|pagination|tags?-list|author-bio|recirc)\b/i;

  if (!document.body) return;
  const all = Array.from(document.body.querySelectorAll('*'));
  for (const el of all) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    if (KILL_TAGS.has(tag)) { el.remove(); continue; }
    const idCls = `${el.id || ''} ${String(el.className || '')}`;
    if (KILL_RE.test(idCls)) { el.remove(); continue; }
    if (el.getAttribute('aria-hidden') === 'true') { el.remove(); continue; }
    if (el.hasAttribute('hidden')) { el.remove(); continue; }
  }
}

// Turndown reads the raw href/src attribute, not the resolved property, so relative
// URLs must be rewritten to absolute before conversion or links break once the
// Markdown leaves the page's context.
function absolutizeUrls(document) {
  for (const a of document.querySelectorAll('a[href]')) {
    a.setAttribute('href', a.href);
  }
  for (const img of document.querySelectorAll('img[src]')) {
    img.setAttribute('src', img.src);
  }
}

function runReadability(document) {
  absolutizeUrls(document);
  const clone = document.cloneNode(true);
  const reader = new Readability(clone, { keepClasses: false });
  const article = reader.parse();
  if (article) {
    return {
      title: article.title || document.title || '',
      content: article.content || '',
      byline: article.byline || '',
      siteName: article.siteName || '',
    };
  }
  return {
    title: document.title || '',
    content: document.body ? document.body.innerHTML : '',
    byline: '',
    siteName: '',
  };
}

// ---------- Markdown conversion ----------

function htmlToMarkdown(html, { keepImages }) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---',
  });
  td.use(gfm);

  // turndown-plugin-gfm only converts tables that have a proper <th> heading row;
  // anything else (virtually all layout tables — email templates, app chrome) falls
  // back to Turndown's keep() and gets emitted as verbatim outerHTML, attributes and
  // all. Override so every table converts through the normal row/cell rules instead.
  td.addRule('anyTable', {
    filter: (node) => node.nodeName === 'TABLE',
    replacement: (content) => `\n\n${content.replace(/\n\n/g, '\n')}\n\n`,
  });

  if (!keepImages) {
    td.addRule('dropImages', { filter: 'img', replacement: () => '' });
  }

  td.addRule('fencedCodeBlock', {
    filter: (node) => node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE',
    replacement: (_content, node) => {
      const codeEl = node.firstChild;
      const cls = codeEl.getAttribute('class') || '';
      const match = cls.match(/(?:language|lang)-(\S+)/);
      const lang = match ? match[1] : '';
      const code = codeEl.textContent.replace(/\n$/, '');
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    },
  });

  td.addRule('dropEmptyLinks', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      const href = node.getAttribute('href') || '';
      return !href || href.startsWith('#') || href.startsWith('javascript:');
    },
    replacement: (content) => content,
  });

  return td.turndown(html);
}

function postProcess(md) {
  md = md.replace(/\r\n/g, '\n');
  // Image-only "badge" links (e.g. shield/store badges) become empty-label links
  // once images are stripped; drop them rather than leaving bare "[](url)" noise.
  md = md.replace(/\[\]\([^)]*\)/g, '');
  md = md.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  md = md.replace(/\n{3,}/g, '\n\n');
  // Turndown pads list markers for nested-indent alignment; collapse to a single
  // space to save tokens (renders identically in Markdown).
  md = md.split('\n').map((l) => l.replace(/^(\s*(?:[-*+]|\d+\.))\s{2,}/, '$1 ')).join('\n');

  // Drop exact-duplicate paragraph/section blocks (boilerplate that leaked through).
  const blocks = md.split(/\n{2,}/);
  const seen = new Set();
  const kept = [];
  for (const block of blocks) {
    const key = block.trim();
    if (key.length > 40) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(block);
  }
  return kept.join('\n\n').trim() + '\n';
}

function slugify(text) {
  return (text || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- extraction pipeline ----------

function extractFromHtml(html, url, { keepImages }) {
  // Strip <style> blocks before parsing: jsdom's bundled CSS parser (cssom) can throw
  // on large/unusual generated stylesheets (seen with saved Gmail pages), and styling
  // is discarded anyway since only text/structure is extracted.
  const safeHtml = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const dom = new JSDOM(safeHtml, { url });
  const { document } = dom.window;

  stripBoilerplate(document);
  const article = runReadability(document);

  let markdown = htmlToMarkdown(article.content, { keepImages });
  markdown = postProcess(markdown);

  const titleHeadingRe = new RegExp(`^#\\s+${article.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
  let body = markdown;
  if (article.title && !titleHeadingRe.test(markdown.split('\n').slice(0, 3).join('\n'))) {
    body = `# ${article.title}\n\n${markdown}`;
  }

  const metaLines = [`Source: ${url}`];
  if (article.byline) metaLines.push(`By: ${article.byline}`);
  if (article.siteName) metaLines.push(`Site: ${article.siteName}`);

  return {
    title: article.title,
    markdown: `${body.trimEnd()}\n\n---\n${metaLines.join(' | ')}\n`,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.file) {
    log('Usage: extract.mjs --file <path> [--source-url <url>] [--save] [--out <dir>] [--keep-images] [--quiet]');
    process.exit(1);
  }

  const html = fs.readFileSync(opts.file, 'utf8');
  const resolvedUrl = opts.sourceUrl || `file://${path.resolve(opts.file)}`;
  const { title, markdown } = extractFromHtml(html, resolvedUrl, { keepImages: opts.keepImages });

  if (opts.save) {
    fs.mkdirSync(opts.out, { recursive: true });
    const outPath = path.join(opts.out, `${slugify(title)}-${dateStamp()}.md`);
    fs.writeFileSync(outPath, markdown, 'utf8');
    log(`Saved: ${outPath}`);
  }
  if (!opts.quiet) process.stdout.write(markdown);
}

try {
  main();
} catch (err) {
  log('Error:', err.stack || err.message);
  process.exit(1);
}
