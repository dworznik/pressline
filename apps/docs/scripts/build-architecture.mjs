// Build the LikeC4 site for docs/architecture into public/architecture/ so
// Astro copies it under <base>/architecture/. DOCS_BASE is what the Pages
// workflow sets (/pressline); empty on the project's own domain. Hash history
// because Astro's own 404 shadows the SPA's under public/, so deep links are
// /architecture/#/view/<id>/ rather than /architecture/view/<id>/.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const docsBase = (process.env['DOCS_BASE'] ?? '/').replace(/\/$/, '')
const base = `${docsBase}/architecture/`
const title = 'Pressline Architecture'
const model = resolve(import.meta.dirname, '../../../docs/architecture')
const output = resolve(import.meta.dirname, '../public/architecture')
const require = createRequire(import.meta.url)
const likec4 = resolve(dirname(require.resolve('likec4/package.json')), 'bin/likec4.mjs')

rmSync(output, { recursive: true, force: true })
const result = spawnSync(
  process.execPath,
  [
    likec4,
    'build',
    model,
    '--base',
    base,
    '--use-hash-history',
    '--title',
    title,
    '--output',
    output,
  ],
  { stdio: 'inherit' },
)
if (result.status !== 0) {
  console.error(`architecture: likec4 build failed`, result.error ?? `exit ${result.status}`)
  process.exit(1)
}
// LikeC4 ships its own favicon and has no option to replace it. The app is
// served from the same origin as the docs, so point it at the docs site's icon
// rather than copying one in (the output directory is wiped every build).
// --title reaches the SPA, which sets document.title once hydrated, but not the
// static shell, so the tab reads "LikeC4" until then.
for (const page of readdirSync(output).filter((f) => f.endsWith('.html'))) {
  const file = resolve(output, page)
  const html = readFileSync(file, 'utf8')
  const branded = html
    .replace(
      /<link rel="icon"[^>]*>/,
      `<link rel="icon" type="image/svg+xml" href="${docsBase}/favicon.svg">`,
    )
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
  if (branded !== html) writeFileSync(file, branded)
}

console.log(`architecture: built into public/architecture with base ${base}`)
