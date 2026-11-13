/**
 * The site's only always‑loaded script: the menu, scroll reveals, the "your course is
 * still here" note, and loading the home page's minis when they come into view.
 * Nothing here is needed to read the site — every page works without JavaScript.
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- menu
const btn = document.querySelector<HTMLButtonElement>('.menu-btn');
const nav = document.querySelector<HTMLElement>('#site-nav');
if (btn && nav) {
  const set = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
  };
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    set(open);
    if (open) nav.querySelector<HTMLElement>('a')?.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
      set(false);
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (btn.getAttribute('aria-expanded') === 'true' && !nav.contains(e.target as Node) && !btn.contains(e.target as Node)) set(false);
  });
}

// ---- scroll reveals (skipped entirely when the visitor asks for less motion)
const reveals = document.querySelectorAll<HTMLElement>('.reveal');
if (reduced || !('IntersectionObserver' in window)) {
  reveals.forEach((el) => el.classList.add('in'));
  document.documentElement.classList.remove('motion');
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  reveals.forEach((el) => io.observe(el));
}

// ---- people who bookmarked the editor when it lived at "/"
// Look for a saved course without creating a database if there isn't one.
const note = document.querySelector<HTMLElement>('#saved-note');
if (note && 'indexedDB' in window && typeof indexedDB.databases === 'function') {
  indexedDB
    .databases()
    .then((dbs) => {
      if (dbs.some((d) => d.name === 'fairway-paint')) note.hidden = false;
    })
    .catch(() => {
      /* private mode: nothing to show */
    });
}

// ---- minis: the real Linksketch code, loaded only when one scrolls into view
const minis = document.querySelectorAll<HTMLElement>('[data-mini]');
if (minis.length) {
  const start = () => void import('./minis').then((m) => m.startMinis(minis, reduced));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '300px' },
    );
    minis.forEach((el) => io.observe(el));
  } else start();
}
