// Refuses a commit while a file under a source folder is gitignored. An
// ignored file is never staged, so lint-staged never sees it and typecheck
// passes on the disk that has it, while the commit lacks it. kakao-ingest,
// modeled on this repo, lost apps/worker/src/coverage/coverage.ts that way to
// an unanchored `coverage/`; `build/` and `coverage/` here would do the same.
// Run by the pre-commit hook on the whole tree.
import { execFileSync } from 'node:child_process'

const SOURCE_ROOTS = [
  ':(glob)apps/*/src/**',
  ':(glob)apps/*/tests/**',
  ':(glob)apps/*/e2e/**',
  ':(glob)apps/*/scripts/**',
  ':(glob)packages/*/src/**',
  ':(glob)packages/*/tests/**',
  'scripts',
  'docs',
  'deploy',
]

const files = execFileSync(
  'git',
  ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...SOURCE_ROOTS],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((line) => line !== '')

if (files.length) {
  console.error(
    'ignored:check: these source files are gitignored, so they would be left out of the commit:\n' +
      files.map((file) => `  ${file}`).join('\n') +
      '\nAnchor or narrow the ignore rule (git check-ignore -v <file> names it).',
  )
  process.exit(1)
}
