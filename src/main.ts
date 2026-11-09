import './styles.css';
import { App } from './app';

const app = new App();
// Handy for debugging in the browser console.
(window as unknown as { fairway: App }).fairway = app;
