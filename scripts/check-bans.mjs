// Guards the three ADR bans that used to be ESLint rules. They moved here when
// the repo swapped ESLint for oxlint (see .oxlintrc.json): oxlint has no
// `no-restricted-syntax` and no Svelte parser, so a lint rule could no longer
// cover .svelte at all. A script covers every source file uniformly, and is
// the reason `pnpm lint` is `oxlint && node scripts/check-bans.mjs`.
//
//   ADR-0001  single-operator, never multi-tenant: no tenant identifiers.
//   ADR-0008  D1 has no interactive transactions: no `withTransaction`.
//   ADR-0002  the bridge never renders or decodes pixels: apps/pressline
//             imports no render helper and no image codec.
//
// Comments and their prose are stripped before matching, so an ADR quoted in a
// doc comment is not a violation. A deliberate exception carries
// `ban-check-ignore` on the same line.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.wrangler',
  '.vercel',
  '.astro',
  'coverage',
  '.git',
])
const EXT = /\.(ts|mts|cts|tsx|js|mjs|cjs|svelte)$/

/** Every source file, depth-first, skipping build output and dependencies. */
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.test(entry)) out.push(full)
  }
  return out
}

/** Blank out comments and string bodies so prose about a ban is not a ban. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))

const BANS = [
  {
    adr: 'ADR-0001',
    what: 'a tenant identifier (single-operator, never multi-tenant)',
    re: /\b(tenantId|tenant_id|tenants?)\b/,
    where: () => true,
  },
  {
    adr: 'ADR-0008',
    what: '`withTransaction` (every write is one statement or a batch)',
    re: /\bwithTransaction\b/,
    where: () => true,
  },
  {
    adr: 'ADR-0002',
    what: 'a render helper or image codec imported into the bridge',
    re: /from\s+['"](@pressline\/render|sharp|@jsquash\/[^'"]+|@resvg\/[^'"]+|jimp|pngjs)['"]/,
    where: (rel) => rel.startsWith(`apps${sep}pressline${sep}`),
  },
]

const errors = []
for (const file of walk(root)) {
  const rel = relative(root, file)
  if (rel === join('scripts', 'check-bans.mjs')) continue
  const lines = code(readFileSync(file, 'utf8')).split('\n')
  for (const ban of BANS) {
    if (!ban.where(rel)) continue
    lines.forEach((line, i) => {
      if (ban.re.test(line) && !line.includes('ban-check-ignore')) {
        errors.push(`${rel}:${i + 1}: ${ban.adr}: ${ban.what}`)
      }
    })
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`\nbans:check failed (${errors.length})`)
  process.exit(1)
}
console.log(`bans:check ok (${BANS.length} bans)`)
