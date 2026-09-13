// What, if anything, a release should publish.
//
// Usage: node scripts/release-status.mjs [tag]
//
// Four questions, because they fail differently. Is every package that releases
// in lockstep actually here? Do they agree on one version? Does the release tag
// name that same version -- the tag announces what shipped, but package.json
// decides. And is the version already on the registry, in which case there is
// nothing to do, which is what makes re-running a half-failed release harmless.
//
// Writes `version=`, `pending=` and `disttag=` as GitHub Actions outputs (stdout
// is meant to be redirected into $GITHUB_OUTPUT); the human summary goes to
// stderr.
import { globSync, readFileSync } from 'node:fs'

const REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org'

// Named rather than discovered. These four publish together, so a package going
// missing or turning private is a mistake to stop on, not a smaller release to
// go ahead with. Adding one is a deliberate edit here -- and a reminder that it
// needs a trusted publisher of its own before it can go out.
const EXPECTED = [
  '@pressline/cli',
  '@pressline/conformance',
  '@pressline/contract',
  '@pressline/render',
]

const packages = globSync('packages/*/package.json')
  .sort()
  .map((path) => ({ path, ...JSON.parse(readFileSync(path, 'utf8')) }))
  .filter((pkg) => pkg.private !== true)

const found = packages.map((pkg) => pkg.name).sort()
const missing = EXPECTED.filter((name) => !found.includes(name))
const unexpected = found.filter((name) => !EXPECTED.includes(name))
if (missing.length > 0 || unexpected.length > 0) {
  console.error('The set of publishable packages is not the one that releases in lockstep.')
  if (missing.length > 0)
    console.error(`  missing (removed, renamed or private?): ${missing.join(', ')}`)
  if (unexpected.length > 0)
    console.error(
      `  unexpected (add it to EXPECTED once it has a trusted publisher): ${unexpected.join(', ')}`,
    )
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

// A prerelease must not take `latest`, or `npm install @pressline/cli` starts
// handing out a release candidate. Anything with a hyphen in its version is one.
const distTag = version.includes('-') ? 'next' : 'latest'

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
console.log(`disttag=${distTag}`)

console.error(
  pending.length === 0
    ? `\nNothing to publish: every package is already at ${version}.`
    : `\n${pending.length} of ${packages.length} packages to publish at ${version} under the ${distTag} tag.`,
)
