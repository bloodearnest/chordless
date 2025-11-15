import { readFileSync, rmSync, mkdirSync, cpSync, readdirSync, lstatSync } from 'fs';
import { dirname, join } from 'path';

const EXCLUDE_PATTERNS = [
  /\.map$/,
  /\.d\.ts$/,
  /\/development\//,
  /\/node\//,
  /\/cjs\//,
  /\/testing\//,
];

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('vendor', { recursive: true, force: true });
for (const dep of Object.keys(pkg.dependencies || {})) {
  const src = join('node_modules', dep);
  const dest = join('vendor', dep);
  mkdirSync(dirname(dest), { recursive: true });
  copyFiltered(src, dest);
}
function copyFiltered(src, dest) {
  const stat = lstatSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      if (shouldExclude(srcPath)) continue;
      copyFiltered(srcPath, destPath);
    }
  } else {
    if (!shouldExclude(src)) {
      cpSync(src, dest);
    }
  }
}
function shouldExclude(path) {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(path));
}
