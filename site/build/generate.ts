/**
 * Builds the website's HTML pages into `.site/` (git‑ignored), which Vite then uses as
 * its root. Pages are plain HTML; scripts and styles are referenced from `src/` and
 * `site/` so Vite bundles and fingerprints them.
 *
 * Words and data come from `content/`:
 *   site.json          who the owner is, their projects
 *   courses.json       the course gallery
 *   pages/*.md         home intro and the About page
 *   writing/*.md       posts and devlogs
 *   manual/*.md        the Linksketch manual
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildInfo, esc, list, loadDocs, longDate, markTodos, parseFrontMatter, readTime, renderMarkdown, rssDate, siteUrl, slugify, str, type BuildInfo, type Doc } from './content';
import { ILLUSTRATIONS, PIXEL_FLAG } from './illustrations';

export interface SitePage {
  /** URL path, e.g. "/about/" (always ends with a slash) or "/404.html". */
  url: string;
  html: string;
}

export interface SiteOutput {
  /** Rollup inputs: name → HTML file. */
  inputs: Record<string, string>;
  /** Files that aren't HTML (feed, sitemap, robots), by URL path. */
  extras: Record<string, string>;
  /** Every page URL, for tests and the sitemap. */
  urls: string[];
}

/** Where a page's file goes inside the output folder. */
export function pageFile(url: string): string {
  return url.endsWith('/') ? `${url.slice(1)}index.html` : url.slice(1);
}

// ---------------------------------------------------------------- data shapes
interface Project {
  id: string;
  name: string;
  pitch: string;
  type: string;
  status: string;
  image: string;
  link: string;
  summary: string;
}
interface Course {
  name: string;
  location: string;
  holes: number;
  par: number;
  cover: string;
  note: string;
  open?: string;
}
interface SiteData {
  url: string;
  owner: { name: string; heroLines: string[]; role: string; location: string; contact: string; github: string };
  license: string;
  projects: Project[];
}
interface Shot {
  w: number;
  h: number;
  alt: string;
}
interface Post {
  slug: string;
  url: string;
  title: string;
  date: string;
  order: number;
  tags: string[];
  summary: string;
  html: string;
  minutes: number;
}
interface Chapter {
  slug: string;
  url: string;
  title: string;
  part: string;
  partNo: number;
  number: string;
  summary: string;
  html: string;
  minutes: number;
  figures: number;
}

interface Ctx {
  site: SiteData;
  base: string;
  build: BuildInfo;
  shots: Record<string, Shot>;
  ownerName: string;
}

const NAV: [string, string][] = [
  ['/', 'Home'],
  ['/about/', 'About'],
  ['/projects/', 'Projects'],
  ['/courses/', 'Courses'],
  ['/writing/', 'Writing'],
  ['/linksketch/', 'Linksketch'],
];

const isTodo = (s: string) => !s || s.startsWith('TODO');
/** Escaped text with any placeholder highlighted. */
const t = (s: string) => markTodos(`>${esc(s)}<`).slice(1, -1);

// ---------------------------------------------------------------- shared chrome
interface PageOpts {
  url: string;
  title: string;
  description: string;
  /** "paper" = the big‑type personal pages; "manual" = reading pages. */
  theme: 'paper' | 'manual';
  kind: string;
  body: string;
  image?: string;
  /** Article pages get richer Open Graph data. */
  article?: { date: string };
  noindex?: boolean;
}

function layout(c: Ctx, o: PageOpts): string {
  const full = `${c.base}${o.url}`;
  const title = o.url === '/' ? `${c.ownerName} — golf course design and Linksketch` : `${o.title} — ${c.ownerName}`;
  const image = `${c.base}${o.image ?? '/og.png'}`;
  const nav = NAV.map(([href, label]) => `<li><a href="${href}"${href === o.url || (href !== '/' && o.url.startsWith(href)) ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const contact = isTodo(c.site.owner.contact)
    ? `<span>${t('Contact: TODO(owner)')}</span>`
    : `<a href="${esc(/^https?:|^mailto:/.test(c.site.owner.contact) ? c.site.owner.contact : `mailto:${c.site.owner.contact}`)}">Contact</a>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(o.description)}" />
    ${o.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${esc(full)}" />`}
    <meta property="og:title" content="${esc(o.title)}" />
    <meta property="og:description" content="${esc(o.description)}" />
    <meta property="og:type" content="${o.article ? 'article' : 'website'}" />
    <meta property="og:url" content="${esc(full)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:site_name" content="${esc(c.ownerName)}" />
    ${o.article ? `<meta property="article:published_time" content="${o.article.date}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="theme-color" content="${o.theme === 'paper' ? '#edeee5' : '#fbfbfb'}" />
    <link rel="icon" href="/icons/linksketch.svg" type="image/svg+xml" />
    <link rel="alternate" type="application/rss+xml" title="Writing" href="/rss.xml" />
    <link rel="preload" href="/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin />
    <script>
      /* Before first paint: cards may fade in on scroll, unless the visitor prefers less motion. */
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) document.documentElement.classList.add('motion');
    </script>
    <link rel="stylesheet" href="%SITE%/styles/site.css" />
    <script type="module" src="%SITE%/client/main.ts"></script>
  </head>
  <body class="theme-${o.theme} page-${o.kind}">
    <a class="skip" href="#main">Skip to content</a>
    <header class="top">
      <a class="home-link" href="/">${t(isTodo(c.site.owner.name) ? 'TODO(owner): your name' : c.site.owner.name)}</a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav"><span class="menu-icon" aria-hidden="true"></span>Menu</button>
      <nav id="site-nav" class="nav" aria-label="Site"><ul>${nav}</ul></nav>
    </header>
    <main id="main">
${o.body}
    </main>
    <footer class="foot">
      <ul class="pipes">
        <li><a href="https://github.com/${esc(c.site.owner.github)}" rel="me">GitHub</a></li>
        <li><a href="/rss.xml">RSS</a></li>
        <li>${contact}</li>
        <li>No tracking, no cookies</li>
        <li>${isTodo(c.site.license) ? t('License: TODO(owner)') : esc(c.site.license)}</li>
      </ul>
      <p class="built">Built from commit <code>${esc(c.build.commit)}</code> on <time datetime="${c.build.date}">${longDate(c.build.date)}</time></p>
    </footer>
    <noscript><style>.nav{display:block;position:static}.reveal{opacity:1;transform:none}</style></noscript>
  </body>
</html>
`;
}

/** A screenshot from public/shots (sizes come from shots.json so nothing jumps while loading). */
function shot(c: Ctx, name: string, cls = '', lazy = true): string {
  const s = c.shots[name];
  if (!s) return `<div class="shot-missing ${cls}">${t(`TODO(owner): picture “${name}” is missing — run npm run shots`)}</div>`;
  return `<img class="${cls}" src="/shots/${name}.webp" width="${s.w}" height="${s.h}" alt="${esc(s.alt)}"${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'} />`;
}

const statusTag = (s: string) => `<span class="status status-${slugify(s)}">${esc(s)}</span>`;

/** A big gallery card: picture, large uppercase title, tiny category tag. */
function card(o: { href?: string; media: string; title: string; tag: string; text?: string; status?: string }): string {
  const inner = `<div class="card-media">${o.media}</div><div class="card-body"><h3 class="card-title">${t(o.title)}</h3><p class="card-tag">${t(o.tag)}${o.status ? ` ${statusTag(o.status)}` : ''}</p>${o.text ? `<p class="card-text">${t(o.text)}</p>` : ''}</div>`;
  return o.href ? `<a class="card reveal" href="${esc(o.href)}">${inner}</a>` : `<div class="card reveal card-todo">${inner}</div>`;
}

const placeholderMedia = (label: string) => `<div class="media-placeholder"><span>${t(label)}</span></div>`;

// ---------------------------------------------------------------- pages
function homePage(c: Ctx, intro: string, posts: Post[], courses: Course[]): string {
  const hero = c.site.owner.heroLines.map((l) => `<span>${esc(l)}</span>`).join('');
  const named = !isTodo(c.site.owner.name);
  const projects = c.site.projects
    .map((p) =>
      card({
        href: p.link || undefined,
        media: p.image ? `<img src="${esc(p.image)}" alt="" width="${c.shots.course?.w ?? 1200}" height="${c.shots.course?.h ?? 800}" loading="lazy" decoding="async" class="pixelated" />` : placeholderMedia('TODO(owner): picture'),
        title: p.name,
        tag: p.type,
        status: p.status,
        text: p.pitch,
      }),
    )
    .join('\n');
  const strip = courses
    .slice(0, 4)
    .map((x) =>
      card({
        href: x.cover ? '/courses/' : undefined,
        media: x.cover ? `<img src="${esc(x.cover)}" alt="" width="1200" height="800" loading="lazy" decoding="async" class="pixelated" />` : placeholderMedia('TODO(owner): course picture'),
        title: x.name,
        tag: `${x.location} · ${x.holes} holes`,
      }),
    )
    .join('\n');
  const latest = posts[0];
  return `      <section class="hero">
        <p class="eyebrow">${t(c.site.owner.role)}</p>
        <h1 class="display hero-name"${named ? '' : ' data-todo'}>${hero}</h1>
        ${named ? '' : `<p class="todo-note">${t('TODO(owner): put your name in content/site.json (name and heroLines)')}</p>`}
        <div class="hero-intro prose-lg">${intro}</div>
        <p class="hero-actions">
          <a class="btn btn-solid" href="/linksketch/app/">Open Linksketch <span aria-hidden="true">→</span></a>
          <a class="btn" href="/linksketch/">What is it?</a>
        </p>
        <p class="saved-note" id="saved-note" hidden>
          <strong>Welcome back.</strong> The editor used to live on this page. Your course is still saved in this browser —
          <a href="/linksketch/app/">open Linksketch</a> to carry on.
        </p>
      </section>

      <section class="band" aria-labelledby="working-on">
        <div class="band-head"><h2 class="label" id="working-on">Working on</h2><a class="more" href="/projects/">All projects</a></div>
        <div class="cards cards-feature">
${projects}
        </div>
      </section>

      <section class="band" aria-labelledby="courses-h">
        <div class="band-head"><h2 class="label" id="courses-h">Courses</h2><a class="more" href="/courses/">All courses</a></div>
        <div class="cards cards-strip">
${strip}
        </div>
      </section>

      <section class="band minis" aria-labelledby="minis-h">
        <div class="band-head"><h2 class="label" id="minis-h">Minis</h2><p class="more">Small live pieces of Linksketch. Drag things.</p></div>
        <div class="mini-grid">
          <figure class="mini reveal" data-mini="pattern">
            <canvas width="420" height="300" aria-label="A golf hole with a draggable shot pattern" tabindex="0"></canvas>
            <figcaption><b>Shot pattern.</b> Drag the oval. The bars count where 800 sample shots finish. <span class="mini-out" data-out aria-live="polite"></span></figcaption>
          </figure>
          <figure class="mini reveal" data-mini="paint">
            <canvas width="420" height="300" aria-label="A tiny pixel canvas you can paint on" tabindex="0"></canvas>
            <figcaption><b>Pixel green.</b> Paint with a surface; the outline draws itself.
              <span class="mini-swatches" data-swatches></span> <span class="mini-out" data-out aria-live="polite"></span></figcaption>
          </figure>
          <figure class="mini reveal" data-mini="ruler">
            <canvas width="420" height="300" aria-label="A yardage ruler you can drag across a hole" tabindex="0"></canvas>
            <figcaption><b>Yardage arcs.</b> Drag the ball. Every pixel is a yard, so distance is just counting. <span class="mini-out" data-out aria-live="polite"></span></figcaption>
          </figure>
        </div>
      </section>

      <section class="band" aria-labelledby="writing-h">
        <div class="band-head"><h2 class="label" id="writing-h">Writing</h2><a class="more" href="/writing/">All writing</a></div>
        ${
          latest
            ? `<a class="latest reveal" href="${latest.url}">
          <p class="meta"><time datetime="${latest.date}">${longDate(latest.date)}</time> · ${latest.minutes} min read</p>
          <h3 class="display latest-title">${esc(latest.title)}</h3>
          <p class="prose-lg">${esc(latest.summary)}</p>
        </a>`
            : ''
        }
      </section>`;
}

function aboutPage(c: Ctx, html: string): string {
  const o = c.site.owner;
  return `      <section class="page-head">
        <p class="eyebrow">About</p>
        <h1 class="display">About</h1>
      </section>
      <div class="about-grid">
        <div class="prose-lg">${html}</div>
        <aside class="facts" aria-label="Quick facts">
          <h2 class="label">Quick facts</h2>
          <dl>
            <dt>Name</dt><dd>${t(o.name)}</dd>
            <dt>Does</dt><dd>${t(o.role)}</dd>
            <dt>Based in</dt><dd>${t(o.location)}</dd>
            <dt>Making</dt><dd><a href="/linksketch/">Linksketch</a></dd>
            <dt>GitHub</dt><dd><a href="https://github.com/${esc(o.github)}">${esc(o.github)}</a></dd>
            <dt>Contact</dt><dd>${t(o.contact)}</dd>
          </dl>
        </aside>
      </div>`;
}

function projectsPage(c: Ctx): string {
  const rows = c.site.projects
    .map(
      (p, i) => `<li class="project reveal">
            <span class="project-no">${String(i + 1).padStart(2, '0')}</span>
            <div class="project-main">
              <h2 class="display project-name">${p.link ? `<a href="${esc(p.link)}">${t(p.name)}</a>` : t(p.name)}</h2>
              <p class="prose-lg">${t(p.summary)}</p>
            </div>
            <p class="project-meta"><span class="card-tag">${t(p.type)}</span> ${statusTag(p.status)}</p>
          </li>`,
    )
    .join('\n');
  return `      <section class="page-head">
        <p class="eyebrow">Everything I've made</p>
        <h1 class="display">Projects</h1>
      </section>
      <ol class="projects">
${rows}
      </ol>`;
}

function coursesPage(courses: Course[]): string {
  const cards = courses
    .map((x) => {
      const media = x.cover ? `<img src="${esc(x.cover)}" alt="Plan of ${esc(x.name)}" width="1200" height="800" loading="lazy" decoding="async" class="pixelated" />` : placeholderMedia('TODO(owner): course picture');
      return `<article class="course reveal">
            <div class="card-media">${media}</div>
            <h2 class="card-title">${t(x.name)}</h2>
            <p class="card-tag">${t(x.location)} · ${x.holes} holes · Par ${x.par}</p>
            <p class="card-text">${t(x.note)}</p>
            ${x.open ? `<p><a class="btn" href="${esc(x.open)}">Open in Linksketch <span aria-hidden="true">→</span></a></p>` : ''}
          </article>`;
    })
    .join('\n');
  return `      <section class="page-head">
        <p class="eyebrow">Golf course designs</p>
        <h1 class="display">Courses</h1>
        <p class="prose-lg lead">Drawn in Linksketch, one pixel to the yard.</p>
      </section>
      <div class="courses">
${cards}
      </div>`;
}

const postLine = (p: Post) => `<li class="post-row reveal">
            <time datetime="${p.date}">${longDate(p.date)}</time>
            <div><h2 class="post-title"><a href="${p.url}">${esc(p.title)}</a></h2><p>${esc(p.summary)}</p></div>
            <p class="post-meta">${p.minutes} min · ${p.tags.map((x) => `<a href="/writing/tags/${slugify(x)}/">${esc(x)}</a>`).join(', ')}</p>
          </li>`;

function writingPage(posts: Post[], tag?: string): string {
  const tags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  const shown = tag ? posts.filter((p) => p.tags.includes(tag)) : posts;
  return `      <section class="page-head">
        <p class="eyebrow">${tag ? `Writing tagged “${esc(tag)}”` : 'Posts and devlogs'}</p>
        <h1 class="wordmark-title">${tag ? esc(tag) : 'Writing'}</h1>
        <p class="tagline">${tags.map((x) => `<a href="/writing/tags/${slugify(x)}/"${x === tag ? ' aria-current="true"' : ''}>${esc(x)}</a>`).join(' ')} <a href="/writing/"${tag ? '' : ' aria-current="true"'}>all</a> <a href="/rss.xml">rss</a></p>
      </section>
      <ol class="post-list" reversed>
${shown.map(postLine).join('\n')}
      </ol>`;
}

function postPage(p: Post, prev?: Post, next?: Post): string {
  return `      <article class="article">
        <header class="article-head">
          <p class="annot">[ ${p.tags.map((x) => `<a href="/writing/tags/${slugify(x)}/">${esc(x.toUpperCase())}</a>`).join(' · ')} ]</p>
          <h1>${esc(p.title)}</h1>
          <p class="meta"><time datetime="${p.date}">${longDate(p.date)}</time> · ${p.minutes} min read</p>
        </header>
        <div class="prose">${p.html}</div>
        <nav class="pager" aria-label="More writing">
          ${prev ? `<a href="${prev.url}" rel="prev"><span class="annot">← OLDER</span>${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a href="${next.url}" rel="next"><span class="annot">NEWER →</span>${esc(next.title)}</a>` : '<span></span>'}
        </nav>
      </article>`;
}

function linksketchPage(c: Ctx, chapters: Chapter[], posts: Post[]): string {
  const features: [string, string, string][] = [
    ['Paint with surfaces', 'A palette of fairway, green, bunker and water. Outlines draw themselves.', 'released'],
    ['Real yardages', 'Every pixel is a yard. Holes measure themselves as you click.', 'released'],
    ['Tee sets & scorecard', 'Back, middle and forward tees, each with its own column.', 'released'],
    ['Real land', 'Trace over public-domain aerial photos of anywhere in the US.', 'beta'],
    ['Terrain', 'Real elevation or sculpted ground, as hillshade and contours.', 'beta'],
    ['Strategy mode', 'Shot patterns for three kinds of player, and the odds of trouble.', 'beta'],
    ['Yardage-book pages', 'Any hole as a printable page; all of them as one PDF.', 'released'],
    ['Presentation sheets', 'Title block, legend, scale bar, north arrow, labels.', 'released'],
    ['Works offline', 'Installs like an app. Your courses never leave your computer.', 'released'],
    ['Wind, slope and roll', 'Strategy on flat, calm ground is only the start.', 'in development'],
  ];
  const devlog = posts.filter((p) => p.tags.includes('linksketch')).slice(0, 3);
  return `      <section class="ls-hero">
        <p class="pixel-mark">${PIXEL_FLAG}<span>Linksketch</span></p>
        <h1 class="display ls-title"><span>Link</span><span>sketch</span></h1>
        <div class="ls-pitch">
          <p class="prose-lg">Linksketch is a drawing tool for golf courses that is as simple as Paint. You get a toolbox, a palette and a canvas — but the palette is fairway, green and bunker, and every pixel is one yard. So the picture you paint can be measured, laid over real land, given contours, and played through in your head with honest shot patterns. It runs in your browser, it is free, and your work stays on your computer.</p>
          <p class="hero-actions">
            <a class="btn btn-solid btn-big" href="/linksketch/app/">Open Linksketch <span aria-hidden="true">→</span></a>
            <a class="btn" href="/linksketch/app/?sample=1">Open the sample course</a>
            <a class="btn" href="/linksketch/manual/">Read the manual</a>
          </p>
          <p class="meta">${statusTag('beta')} Free · no account · Mac, Windows, Linux · best with a mouse or trackpad</p>
        </div>
        <figure class="ls-ill">${ILLUSTRATIONS['green-complex']()}<figcaption class="annot vertical">[ GREEN COMPLEX ] FIG. 0.1</figcaption></figure>
      </section>

      <section class="band" aria-labelledby="look">
        <div class="band-head"><h2 class="label" id="look">A look</h2><p class="more">Real screenshots of the sample course</p></div>
        <div class="shots">
          <figure class="reveal shot-wide">${shot(c, 'editor', 'pixelated', false)}<figcaption>The editor. A toolbox, a palette, a canvas — and a scorecard.</figcaption></figure>
          <figure class="reveal">${shot(c, 'strategy', 'pixelated')}<figcaption>Strategy mode: where a 10 handicap's shots finish on the fourth.</figcaption></figure>
          <figure class="reveal">${shot(c, 'terrain', 'pixelated')}<figcaption>Hillshade and five-foot contours.</figcaption></figure>
          <figure class="reveal">${shot(c, 'holepage')}<figcaption>A yardage-book page, straight from the drawing.</figcaption></figure>
          <figure class="reveal">${shot(c, 'sheet')}<figcaption>The presentation sheet.</figcaption></figure>
        </div>
      </section>

      <section class="band" aria-labelledby="does">
        <div class="band-head"><h2 class="label" id="does">What it does</h2><p class="more">With honest status labels</p></div>
        <ul class="features">
${features.map(([name, text, st]) => `          <li class="feature reveal"><h3>${esc(name)}</h3><p>${esc(text)}</p>${statusTag(st)}</li>`).join('\n')}
        </ul>
      </section>

      <section class="band two-up">
        <div>
          <div class="band-head"><h2 class="label">Manual</h2><a class="more" href="/linksketch/manual/">All ${chapters.length} chapters</a></div>
          <ol class="mini-toc">
${chapters.filter((ch) => ['1.1', '4.1', '4.2', '4.3', '5.1'].includes(ch.number)).map((ch) => `            <li><a href="${ch.url}"><span class="annot">${ch.number}</span> ${esc(ch.title)}</a></li>`).join('\n')}
          </ol>
        </div>
        <div>
          <div class="band-head"><h2 class="label">Devlog</h2><a class="more" href="/writing/tags/linksketch/">All entries</a></div>
          <ol class="mini-toc">
${devlog.map((p) => `            <li><a href="${p.url}"><span class="annot">${p.date}</span> ${esc(p.title)}</a></li>`).join('\n')}
          </ol>
        </div>
      </section>`;
}

function manualIndex(chapters: Chapter[]): string {
  const parts = [...new Set(chapters.map((ch) => ch.part))];
  const total = chapters.reduce((n, ch) => n + ch.minutes, 0);
  return `      <section class="page-head manual-head">
        <p class="pixel-mark"><a href="/linksketch/">${PIXEL_FLAG}<span>Linksketch</span></a></p>
        <h1 class="wordmark-title">The Manual</h1>
        <p class="tagline">A reference for how Linksketch works, and why. ${chapters.length} chapters · about ${total} minutes · ${chapters.reduce((n, ch) => n + ch.figures, 0)} figures.</p>
      </section>
      <div class="toc">
${parts
  .map((part, i) => {
    const list = chapters.filter((ch) => ch.part === part);
    return `        <section class="toc-part" aria-labelledby="part-${i + 1}">
          <h2 id="part-${i + 1}"><span class="annot">PART ${i + 1}</span>${esc(part)}</h2>
          <ol>
${list
  .map(
    (ch) => `            <li class="toc-row">
              <a href="${ch.url}"><span class="toc-no">${ch.number}</span><span class="toc-title">${esc(ch.title)}</span></a>
              <p class="toc-sum">${esc(ch.summary)}</p>
              <p class="toc-meta">${ch.minutes} MIN${ch.figures ? ` · ${ch.figures} FIG.` : ''}</p>
            </li>`,
  )
  .join('\n')}
          </ol>
        </section>`;
  })
  .join('\n')}
      </div>`;
}

function chapterPage(ch: Chapter, chapters: Chapter[]): string {
  const i = chapters.indexOf(ch);
  const prev = chapters[i - 1];
  const next = chapters[i + 1];
  const parts = [...new Set(chapters.map((x) => x.part))];
  const side = parts
    .map(
      (part) => `<li><span class="annot">${esc(part.toUpperCase())}</span><ol>${chapters
        .filter((x) => x.part === part)
        .map((x) => `<li><a href="${x.url}"${x === ch ? ' aria-current="page"' : ''}><span class="toc-no">${x.number}</span> ${esc(x.title)}</a></li>`)
        .join('')}</ol></li>`,
    )
    .join('');
  return `      <div class="manual">
        <nav class="manual-side" aria-label="Manual chapters">
          <p class="pixel-mark"><a href="/linksketch/manual/">${PIXEL_FLAG}<span>Manual</span></a></p>
          <ol>${side}</ol>
        </nav>
        <article class="article">
          <header class="article-head">
            <p class="annot">[ PART ${ch.partNo} · ${esc(ch.part.toUpperCase())} ] CHAPTER ${ch.number}</p>
            <h1>${esc(ch.title)}</h1>
            <p class="lead">${esc(ch.summary)}</p>
            <p class="meta">${ch.minutes} min read${ch.figures ? ` · ${ch.figures} figure${ch.figures > 1 ? 's' : ''}` : ''}</p>
          </header>
          <div class="prose">${ch.html}</div>
          <nav class="pager" aria-label="Chapters">
            ${prev ? `<a href="${prev.url}" rel="prev"><span class="annot">← ${prev.number}</span>${esc(prev.title)}</a>` : '<span></span>'}
            ${next ? `<a href="${next.url}" rel="next"><span class="annot">${next.number} →</span>${esc(next.title)}</a>` : '<span></span>'}
          </nav>
        </article>
      </div>`;
}

const notFound = () => `      <section class="page-head">
        <p class="eyebrow">404 · out of bounds</p>
        <h1 class="display">Lost ball</h1>
        <p class="prose-lg lead">That page isn't here. If you were looking for the Linksketch editor, it has moved.</p>
        <p class="hero-actions"><a class="btn btn-solid" href="/linksketch/app/">Open Linksketch <span aria-hidden="true">→</span></a> <a class="btn" href="/">Home</a></p>
      </section>`;

// ---------------------------------------------------------------- figures in manual text
/**
 * Replace `{{fig name | KICKER | Caption}}` lines with numbered figures. `name` is an
 * illustration from illustrations.ts, or `shot:file` for a screenshot.
 */
function renderFigures(md: string, c: Ctx, partNo: number, counter: { n: number }): { md: string; count: number } {
  let count = 0;
  const out = md.replace(/^\{\{fig\s+([^|}]+)\|([^|}]*)\|([^}]*)\}\}$/gm, (_m, rawName: string, kicker: string, caption: string) => {
    const name = rawName.trim();
    counter.n++;
    count++;
    const label = `FIG. ${partNo}.${counter.n}`;
    const body = name.startsWith('shot:') ? shot(c, name.slice(5), /holepage|sheet/.test(name) ? '' : 'pixelated') : (ILLUSTRATIONS[name]?.() ?? `<div class="shot-missing">Unknown figure “${esc(name)}”</div>`);
    return `<figure class="fig${name.startsWith('shot:') ? ' fig-shot' : ''}"><div class="fig-frame"><span class="annot vertical" aria-hidden="true">[ ${esc(kicker.trim())} ]</span>${body}</div><figcaption><span class="annot">${label}</span> ${esc(caption.trim())}</figcaption></figure>`;
  });
  return { md: out, count };
}

// ---------------------------------------------------------------- feeds
function rss(c: Ctx, posts: Post[]): string {
  const items = posts
    .slice(0, 30)
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${c.base}${p.url}</link>
      <guid isPermaLink="true">${c.base}${p.url}</guid>
      <pubDate>${rssDate(p.date)}</pubDate>
      ${p.tags.map((x) => `<category>${esc(x)}</category>`).join('')}
      <description>${esc(p.summary)}</description>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(c.ownerName)} — Writing</title>
    <link>${c.base}/writing/</link>
    <atom:link href="${c.base}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Posts and Linksketch devlogs.</description>
    <language>en</language>
    <lastBuildDate>${rssDate(posts[0]?.date ?? c.build.date)}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function sitemap(c: Ctx, urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${c.base}${u}</loc></url>`).join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------- main
/**
 * `dev` is true for the Vite dev server: scripts and styles outside Vite's root are then
 * addressed as /@fs/… (the dev server can't follow "../" out of its root, the build can).
 */
export function generateSite(repo: string, outDir = '.site', dev = false): SiteOutput {
  const out = resolve(repo, outDir);
  rmSync(out, { recursive: true, force: true });
  const read = (p: string) => readFileSync(join(repo, p), 'utf8');
  const site = JSON.parse(read('content/site.json')) as SiteData;
  const courses = JSON.parse(read('content/courses.json')) as Course[];
  const shotsFile = join(repo, 'public/shots/shots.json');
  const c: Ctx = {
    site,
    base: siteUrl(site.url),
    build: buildInfo(repo),
    shots: existsSync(shotsFile) ? (JSON.parse(readFileSync(shotsFile, 'utf8')) as Record<string, Shot>) : {},
    ownerName: isTodo(site.owner.name) ? 'Linksketch' : site.owner.name,
  };

  // Writing, newest first.
  const posts: Post[] = loadDocs(join(repo, 'content/writing'))
    .map((d: Doc) => {
      const slug = d.slug.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      return {
        slug,
        url: `/writing/${slug}/`,
        title: str(d.meta.title, slug),
        date: str(d.meta.date, c.build.date),
        order: Number(str(d.meta.order, '0')),
        tags: list(d.meta.tags),
        summary: str(d.meta.summary),
        html: renderMarkdown(d.body),
        minutes: readTime(d.body),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order);

  // Manual chapters, in order; figures are numbered through each part.
  const docs = loadDocs(join(repo, 'content/manual')).sort((a, b) => Number(str(a.meta.order)) - Number(str(b.meta.order)));
  const partNames = [...new Set(docs.map((d) => str(d.meta.part)))];
  const counters = new Map<string, { n: number }>();
  const chapters: Chapter[] = docs.map((d) => {
    const part = str(d.meta.part);
    const partNo = partNames.indexOf(part) + 1;
    if (!counters.has(part)) counters.set(part, { n: 0 });
    const figs = renderFigures(d.body, c, partNo, counters.get(part)!);
    const slug = d.slug.replace(/^\d+-\d+-/, '');
    return {
      slug,
      url: `/linksketch/manual/${slug}/`,
      title: str(d.meta.title, slug),
      part,
      partNo,
      number: str(d.meta.order),
      summary: str(d.meta.summary),
      html: renderMarkdown(figs.md),
      minutes: readTime(d.body),
      figures: figs.count,
    };
  });

  const page = (name: string) => parseFrontMatter(read(`content/pages/${name}.md`)).body;
  const pages: SitePage[] = [];
  const add = (o: PageOpts) => pages.push({ url: o.url, html: layout(c, o) });

  add({ url: '/', title: c.ownerName, theme: 'paper', kind: 'home', description: 'Golf course design, and Linksketch — a Paint-simple pixel-art tool for designing golf courses with real yardages, terrain and strategy.', body: homePage(c, renderMarkdown(page('home')), posts, courses) });
  add({ url: '/about/', title: 'About', theme: 'paper', kind: 'about', description: 'Who makes Linksketch, and why.', body: aboutPage(c, renderMarkdown(page('about'))) });
  add({ url: '/projects/', title: 'Projects', theme: 'paper', kind: 'projects', description: 'Everything I have made, starting with Linksketch.', body: projectsPage(c) });
  add({ url: '/courses/', title: 'Courses', theme: 'paper', kind: 'courses', description: 'A gallery of golf course designs drawn in Linksketch.', body: coursesPage(courses), image: '/courses/kestrel-dunes.webp' });
  add({ url: '/writing/', title: 'Writing', theme: 'manual', kind: 'writing', description: 'Posts and Linksketch devlogs.', body: writingPage(posts) });
  for (const tag of new Set(posts.flatMap((p) => p.tags)))
    add({ url: `/writing/tags/${slugify(tag)}/`, title: `Writing: ${tag}`, theme: 'manual', kind: 'writing', description: `Posts and Linksketch devlogs tagged “${tag}”.`, body: writingPage(posts, tag) });
  posts.forEach((p, i) => add({ url: p.url, title: p.title, theme: 'manual', kind: 'post', description: p.summary, body: postPage(p, posts[i + 1], posts[i - 1]), article: { date: p.date } }));
  add({ url: '/linksketch/', title: 'Linksketch', theme: 'paper', kind: 'linksketch', description: 'Linksketch: paint a golf course as simply as in Paint — with real yardages, terrain, tee sets, strategy and printable yardage-book pages. Free, in your browser.', body: linksketchPage(c, chapters, posts), image: '/shots/course.webp' });
  add({ url: '/linksketch/manual/', title: 'Linksketch manual', theme: 'manual', kind: 'manual-index', description: 'The Linksketch reference manual: drawing, holes and yardage, maps and terrain, strategy, exporting.', body: manualIndex(chapters) });
  for (const ch of chapters) add({ url: ch.url, title: `${ch.title} · Linksketch manual`, theme: 'manual', kind: 'chapter', description: ch.summary, body: chapterPage(ch, chapters) });
  add({ url: '/404.html', title: 'Page not found', theme: 'paper', kind: 'notfound', description: 'That page is not here.', body: notFound(), noindex: true });

  // The editor itself. Its HTML is hand‑written (site/app.html).
  pages.push({ url: '/linksketch/app/', html: read('site/app.html') });

  const inputs: Record<string, string> = {};
  for (const p of pages) {
    const file = join(out, pageFile(p.url));
    mkdirSync(dirname(file), { recursive: true });
    // %SRC% and %SITE% become relative paths back into the repo, so Vite bundles them.
    const rel = (target: string) => (dev ? `/@fs${join(repo, target).split('\\').join('/')}` : relative(dirname(file), join(repo, target)).split('\\').join('/'));
    writeFileSync(file, p.html.replaceAll('%SRC%', rel('src')).replaceAll('%SITE%', rel('site')));
    inputs[pageFile(p.url).replace(/\.html$/, '').replace(/[/]/g, '_') || 'index'] = file;
  }
  const urls = pages.map((p) => p.url).filter((u) => u !== '/404.html');
  return {
    inputs,
    urls,
    extras: {
      '/rss.xml': rss(c, posts),
      '/sitemap.xml': sitemap(c, urls),
      '/robots.txt': `User-agent: *\nAllow: /\nSitemap: ${c.base}/sitemap.xml\n`,
    },
  };
}
