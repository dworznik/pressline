# Rulesets

`main.json` is what protects `main`. GitHub does not read this file — nothing
applies it automatically. It is here so the protection is reviewable in a diff,
reproducible on a fork or a re-created repo, and greppable by an agent that
would otherwise have to guess what the server enforces.

The one rule that matters to anyone editing CI: the only required status check
is `ci-ok`, the aggregate job at the bottom of `ci.yml`. Required checks are
matched by job name, so requiring the real jobs would freeze their names —
renaming one would leave a required context that nothing ever reports, and every
pull request would wait on it forever. Enroll a new job in the gate by adding it
to `ci-ok`'s `needs`, not by adding its name here.

The Operator's account is a bypass actor, so a stuck check can always be merged
through by hand. That is deliberate: a gate nobody can open is worse than the
drift it prevents.

## Apply it

```sh
# first time
gh api repos/:owner/:repo/rulesets -X POST --input .github/rulesets/main.json

# afterwards, with the id from `gh api repos/:owner/:repo/rulesets`
gh api repos/:owner/:repo/rulesets/RULESET_ID -X PUT --input .github/rulesets/main.json
```

## Check it against the server

```sh
# which rules are live on main
gh api repos/:owner/:repo/rules/branches/main --jq '[.[].type] | sort'

# what main actually requires
gh api repos/:owner/:repo/rules/branches/main \
  --jq '.[] | select(.type=="required_status_checks")
             | .parameters.required_status_checks[].context'
```

Drift means someone changed the protection in the settings UI. The file is the
intent; reconcile toward it or update it to match the decision that was made.
