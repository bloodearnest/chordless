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

// Used only by the Cloudflare Worker (bundled by wrangler from node_modules),
// never by the browser, so they must not be copied into public/.
const WORKER_ONLY = new Set(['jose', 'google-auth-library']);

const VENDOR_DIR = 'public/vendor';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync(VENDOR_DIR, { recursive: true, force: true });
for (const dep of Object.keys(pkg.dependencies || {})) {
  if (WORKER_ONLY.has(dep)) continue;
  const src = join('node_modules', dep);
  const dest = join(VENDOR_DIR, dep);
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
