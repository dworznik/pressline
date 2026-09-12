// What, if anything, a push to main should publish.
//
// Two questions, because they fail differently. Do the packages agree on one
// version? A disagreement is a mistake in the bump and stops the build. And is
// that version already on the registry? Almost always yes, which is the boring
// path: nothing to do.
//
// Writes `version=` and `pending=` as GitHub Actions outputs (stdout is meant to
// be redirected into $GITHUB_OUTPUT); prints a human summary on stderr.
import { globSync, readFileSync } from 'node:fs'

const REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org'

const packages = globSync('packages/*/package.json')
  .sort()
  .map((path) => ({ path, ...JSON.parse(readFileSync(path, 'utf8')) }))
  .filter((pkg) => pkg.private !== true)

if (packages.length === 0) {
  console.error('No publishable packages under packages/*.')
  process.exit(1)
}

const versions = [...new Set(packages.map((pkg) => pkg.version))]
if (versions.length > 1) {
  console.error('The packages release in lockstep but disagree on the version:')
  for (const pkg of packages) console.error(`  ${pkg.name} ${pkg.version}`)
  process.exit(1)
}

const version = versions[0]

/** Is this exact version already on the registry? The per-version endpoint
 * answers without pulling the whole packument. */
async function isPublished({ name, version }) {
  const url = `${REGISTRY}/${name.replace('/', '%2f')}/${version}`
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (response.status === 200) return true
  if (response.status === 404) return false
  throw new Error(`${name}@${version}: registry answered ${response.status}`)
}

const pending = []
for (const pkg of packages) {
  const published = await isPublished(pkg)
  console.error(`${published ? 'published' : 'PENDING  '} ${pkg.name}@${pkg.version}`)
  if (!published) pending.push(pkg.name)
}

console.log(`version=${version}`)
console.log(`pending=${pending.join(',')}`)

console.error(
  pending.length === 0
    ? `\nNothing to publish: every package is already at ${version}.`
    : `\n${pending.length} of ${packages.length} packages to publish at ${version}.`,
)
