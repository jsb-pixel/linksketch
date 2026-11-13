// Copies the site's self-hosted fonts from their npm packages into public/fonts.
// Run once after changing fonts: node scripts/copy-fonts.mjs   (the copies are committed)
// All are free fonts under the SIL Open Font License; see public/fonts/LICENSES.md.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = [
  ['@fontsource-variable/archivo', 'archivo-latin-wght-normal.woff2', 'archivo.woff2', 'Archivo'],
  ['@fontsource-variable/newsreader', 'newsreader-latin-wght-normal.woff2', 'newsreader.woff2', 'Newsreader'],
  ['@fontsource-variable/newsreader', 'newsreader-latin-wght-italic.woff2', 'newsreader-italic.woff2', 'Newsreader (italic)'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono.woff2', 'JetBrains Mono'],
  ['@fontsource/silkscreen', 'silkscreen-latin-400-normal.woff2', 'silkscreen.woff2', 'Silkscreen'],
];
let notes = '# Fonts\n\nSelf-hosted copies (Latin subset) of free fonts. Nothing is loaded from Google Fonts or any other site.\n\n| File | Font | License | Source package |\n|---|---|---|---|\n';
for (const [pkg, file, out, name] of fonts) {
  copyFileSync(join(root, 'node_modules', pkg, 'files', file), join(root, 'public/fonts', out));
  const meta = JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
  notes += `| ${out} | ${name} | ${meta.license} | ${pkg}@${meta.version} |\n`;
  console.log('copied', out, meta.license);
}
notes += '\nThe SIL Open Font License 1.1 allows using, embedding and redistributing these fonts, including commercially: https://openfontlicense.org\n';
writeFileSync(join(root, 'public/fonts/LICENSES.md'), notes);
