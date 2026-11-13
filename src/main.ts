import './styles.css';
import { App } from './app';

const app = new App();
// Handy for debugging in the browser console.
(window as unknown as { fairway: App }).fairway = app;

// Installable app: cache the editor itself so it opens offline (production builds only;
// maps and elevation always need a connection). See site/build/sw.ts.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/linksketch/app/sw.js', { scope: '/linksketch/app/' }).catch((err) => console.warn('Offline support is unavailable', err));
  });
}
