/** Loads the site's words and data from `content/`. */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';

export interface Doc {
  slug: string;
  meta: Record<string, string | string[]>;
  /** Markdown body (front matter removed). */
  body: string;
}

/** Split `---` front matter (simple `key: value` lines; `[a, b]` lists) from the body. */
export function parseFrontMatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[key] = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    meta[key] = v;
  }
  return { meta, body: m[2] };
}

export function loadDocs(dir: string): Doc[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ slug: f.replace(/\.md$/, ''), ...parseFrontMatter(readFileSync(join(dir, f), 'utf8')) }));
}

export const str = (v: string | string[] | undefined, d = ''): string => (typeof v === 'string' ? v : d);
export const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Words → minutes, at an unhurried 220 words a minute. */
export function readTime(markdown: string): number {
  const words = markdown.replace(/\{\{[^}]*\}\}|<!--[\s\S]*?-->|[#*_`|>-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** URL‑safe slug of a heading or tag. */
export const slugify = (s: string): string => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Highlight unfinished placeholders so the owner can't miss them. Only text between
 * tags is touched, never attributes.
 */
export function markTodos(html: string): string {
  return html.replace(/>([^<]*)</g, (whole, t: string) => {
    const i = t.indexOf('TODO(owner)');
    return i < 0 ? whole : `>${t.slice(0, i)}<mark class="todo">${t.slice(i)}</mark><`;
  });
}

/** Markdown → HTML: comments dropped, headings given ids, tables made scrollable, placeholders highlighted. */
export function renderMarkdown(md: string): string {
  let html = marked.parse(md.replace(/<!--[\s\S]*?-->/g, ''), { async: false }) as string;
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => `<h${level} id="${slugify(inner.replace(/<[^>]+>/g, ''))}">${inner}</h${level}>`);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return markTodos(html);
}

/** Every `TODO(owner)` placeholder in the content folder, for the report. */
export function findTodos(repo: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(md|json)$/.test(f.name)) for (const m of readFileSync(p, 'utf8').matchAll(/TODO\(owner\)[^"\n<]*/g)) out.push({ file: p.slice(repo.length + 1), text: m[0].trim() });
    }
  };
  walk(join(repo, 'content'));
  return out;
}

export interface BuildInfo {
  commit: string;
  date: string;
}

/** The commit the site was built from (from git, or the host's environment). */
export function buildInfo(repo: string): BuildInfo {
  const env = process.env;
  let commit = (env.COMMIT_REF ?? env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA ?? '').slice(0, 7);
  let date = '';
  try {
    if (!commit) commit = execSync('git rev-parse --short HEAD', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    date = execSync('git log -1 --format=%cs', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  return { commit: commit || 'unknown', date: date || new Date().toISOString().slice(0, 10) };
}

/** The site's public address: from content/site.json, else the host's environment. */
export function siteUrl(configured: string): string {
  const fromEnv = process.env.URL ?? process.env.CF_PAGES_URL ?? '';
  const v = configured && !configured.startsWith('TODO') ? configured : fromEnv || 'https://example.com';
  return v.replace(/\/+$/, '');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-11-09" → "November 9, 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
/** RFC 822 date for RSS (noon UTC, so it reads as the same day everywhere). */
export function rssDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toUTCString();
}
