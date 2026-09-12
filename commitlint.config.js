export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The ten types the commit-msg hook and CLAUDE.md document, and no more: a
    // type nobody uses is how a spec stops describing reality. `adr` is ours,
    // for a decision record; `perf` and `build` come from the conventional set.
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'test', 'refactor', 'chore', 'ci', 'build', 'perf', 'adr'],
    ],
    // The hook's own limit, kept here so both agree.
    'header-max-length': [2, 'always', 72],
    // Subjects in this repo read as sentences ("wait for the provider to …").
    'subject-case': [0],
  },
}
