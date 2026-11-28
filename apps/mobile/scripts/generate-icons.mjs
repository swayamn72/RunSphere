// Turns the SVG files in `assets/icons/lucide` into `src/components/lucide-icons.ts`,
// so React Native can draw them without an SVG transformer in the bundler.
//
//   node apps/mobile/scripts/generate-icons.mjs
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { renderIconModule } from './icon-module.mjs';

const folder = new URL('../assets/icons/lucide/', import.meta.url);
const names = (await readdir(folder)).filter((file) => file.endsWith('.svg')).sort();
const files = await Promise.all(
  names.map(async (file) => [file.slice(0, -4), await readFile(new URL(file, folder), 'utf8')])
);
await writeFile(
  new URL('../src/components/lucide-icons.ts', import.meta.url),
  renderIconModule(files)
);
globalThis.console.log(`Wrote ${files.length} icons.`);
