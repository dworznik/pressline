---
title: CLI
description: pressline — the Operator's command line.
---

```sh
npx @pressline/cli --url https://shop.example --token $OPERATOR_TOKEN <command>
```

`--url` and `--token` can come from `PRESSLINE_URL` and `PRESSLINE_TOKEN`. Every command is a client of the operator API; the CLI never touches the database.

| Command                                                                     | What it does                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `doctor`                                                                    | Config, secrets, provider reachability, Engine health, webhook registration; exit 1 with the problems |
| `catalogue search <text>`                                                   | Printful products by name with variants, Specs and an Offer snippet                                   |
| `catalogue check`                                                           | Every configured Offer resolves                                                                       |
| `webhooks register [--public-url]`                                          | Create or verify both webhook endpoints; prints the secrets once                                      |
| `orders list [--state] [--limit]` · `orders show <id>`                      | The ledger                                                                                            |
| `orders create … --paid-outside [--send-email]`                             | An order paid outside Stripe (reprint, offline sale)                                                  |
| `orders resubmit <id>` · `orders fix-address <id> …` · `orders cancel <id>` | Recovery without provider dashboards                                                                  |
| `orders purge --older-than <days>`                                          | Strip personal data from finished orders                                                              |
| `reconcile [--dry-run]`                                                     | Run Reconciliation now                                                                                |
| `printfile check <url> --offer --variant`                                   | Any image URL against an Offer variant's Spec                                                         |
