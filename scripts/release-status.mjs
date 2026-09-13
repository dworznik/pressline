// What, if anything, a release should publish.
//
// Usage: node scripts/release-status.mjs [tag]
//
// Three questions, because they fail differently. Do the packages agree on one
// version? A disagreement is a mistake in the bump. Does the release tag name
// that same version? The tag announces what shipped, but package.json decides,
// and the two disagreeing would publish something other than what the release
// says. And is the version already on the registry? Then there is nothing to do,
// which makes a re-run harmless.
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

// Only a release passes a tag. A rehearsal has none, and judges the manifests alone.
const tag = process.argv[2]
if (tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)
  if (!match) {
    console.error(`Tag ${tag} is not of the form v<semver>, e.g. v0.2.0 or v0.2.0-rc.1.`)
    process.exit(1)
  }
  if (match[1] !== version) {
    console.error(
      `Release ${tag} announces ${match[1]}, but the packages are at ${version}. ` +
        `Bump them on main and re-tag, or retag the release.`,
    )
    process.exit(1)
  }
}

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
