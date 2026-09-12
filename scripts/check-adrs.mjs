// Guards docs/adr/: contiguous zero-padded numbering, unique numbers, a status
// frontmatter with a known value, and a top-level title. Run by CI and by
// lint-staged when an ADR changes.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'docs', 'adr')
const STATUSES = new Set(['proposed', 'accepted', 'deprecated'])
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort()
const errors = []
const seen = new Set()

files.forEach((file, i) => {
  const m = /^(\d{4})-[a-z0-9-]+\.md$/.exec(file)
  if (!m) return errors.push(`${file}: name must be NNNN-kebab-slug.md`)
  const n = Number(m[1])
  if (seen.has(n)) errors.push(`${file}: duplicate number ${n}`)
  seen.add(n)
  if (n !== i + 1) errors.push(`${file}: expected number ${String(i + 1).padStart(4, '0')}`)

  const text = readFileSync(join(dir, file), 'utf8')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!fm) return errors.push(`${file}: missing frontmatter`)
  const status = /^status:\s*(.+)$/m.exec(fm[1])?.[1]?.trim()
  if (!status) errors.push(`${file}: missing status`)
  else if (!STATUSES.has(status) && !/^superseded by ADR-\d{4}$/.test(status))
    errors.push(`${file}: unknown status "${status}"`)
  if (!/^# .+/m.test(text.slice(fm[0].length))) errors.push(`${file}: missing "# Title"`)
})

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`adr:check ok (${files.length} ADRs)`)
