// The published version comes from each package.json, not from the tag, so a tag
// that disagrees with them would publish something other than what it names.
// Refuse that: the four packages release in lockstep at one version.
import { globSync, readFileSync } from 'node:fs'

const tag = process.argv[2]
if (!tag) {
  console.error('usage: node scripts/check-release-tag.mjs <tag>')
  process.exit(2)
}

const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)
if (!match) {
  console.error(`Tag ${tag} is not of the form v<semver>, e.g. v0.2.0 or v0.2.0-rc.1.`)
  process.exit(1)
}
const expected = match[1]

const manifests = globSync('packages/*/package.json').sort()
const publishable = manifests
  .map((path) => ({ path, pkg: JSON.parse(readFileSync(path, 'utf8')) }))
  .filter(({ pkg }) => pkg.private !== true)

if (publishable.length === 0) {
  console.error('No publishable packages found under packages/*.')
  process.exit(1)
}

const wrong = publishable.filter(({ pkg }) => pkg.version !== expected)
for (const { path, pkg } of publishable) {
  console.log(`${pkg.version === expected ? 'ok  ' : 'BAD '} ${pkg.name} ${pkg.version} (${path})`)
}

if (wrong.length > 0) {
  console.error(
    `\nRelease ${tag} expects every package at ${expected}, but ${wrong
      .map(({ pkg }) => `${pkg.name} is ${pkg.version}`)
      .join(', ')}. Bump them on main and re-tag.`,
  )
  process.exit(1)
}

console.log(`\nAll ${publishable.length} packages are at ${expected}.`)
