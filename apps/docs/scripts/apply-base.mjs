// Prefix site-absolute links in the built HTML with DOCS_BASE (GitHub Pages
// serves the site under /pressline). Starlight's own chrome already carries
// the base; only links written in Markdown (`/operator/deploy/`, `/openapi.json`)
// and the Architecture pages' `<iframe src="/architecture/...">` embeds need it.
// A no-op without DOCS_BASE.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = (process.env['DOCS_BASE'] ?? '/').replace(/\/$/, '')
if (!base) process.exit(0)

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : []
  })

const already = new RegExp(`^${base.replace(/[/.]/g, '\\$&')}(/|$)`)
let touched = 0
for (const file of walk('dist')) {
  const html = readFileSync(file, 'utf8')
  const out = html.replace(/(href|src)="(\/[^/"][^"]*|\/)"/g, (m, attr, url) =>
    already.test(url) ? m : `${attr}="${base}${url}"`,
  )
  if (out !== html) {
    writeFileSync(file, out)
    touched++
  }
}
console.log(`apply-base: ${base} on ${touched} pages`)
