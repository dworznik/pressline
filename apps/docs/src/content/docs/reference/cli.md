---
title: CLI
description: pressline — the command line for one instance, for the Operator and the Engine developer.
---

```sh
npx @pressline/cli --url https://shop.example --token $OPERATOR_TOKEN <command>
```

`--url` and `--token` can come from `PRESSLINE_URL` and `PRESSLINE_TOKEN`. Every command is a client of the instance; the CLI never touches the database. The Operator's commands call the operator API and need the token. The Engine developer's commands, `offers` and `engine …`, read public endpoints or the Engine itself and need none.

## Operator

| Command                                                                     | What it does                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `doctor`                                                                    | Config, secrets, provider reachability, Engine health, webhook registration; exit 1 with the problems |
| `catalog search <text>`                                                     | Printful products by name with variants, Specs and an Offer snippet                                   |
| `catalog check`                                                             | Every configured Offer resolves                                                                       |
| `webhooks register [--public-url]`                                          | Create or verify both webhook endpoints; prints the secrets once                                      |
| `orders list [--state] [--limit]` · `orders show <id>`                      | The ledger                                                                                            |
| `orders create … --paid-outside [--send-email]`                             | An order paid outside Stripe (reprint, offline sale)                                                  |
| `orders resubmit <id>` · `orders fix-address <id> …` · `orders cancel <id>` | Recovery without provider dashboards                                                                  |
| `orders purge --older-than <days>`                                          | Strip personal data from finished orders                                                              |
| `reconcile [--dry-run]`                                                     | Run Reconciliation now                                                                                |
| `printfile check <url> --offer --variant`                                   | Any image URL against an Offer variant's Spec                                                         |

## Engine developer

| Command                                                                            | What it does                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `offers [--json]`                                                                  | The Offers this instance sells, one line per distinct Printfile Spec with the variant keys that share it; no token |
| `engine conformance <baseUrl> --secret --design [--dpi] [--timeout] [--any-shape]` | Run the [conformance suite](/engine/conformance/) against an Engine                                                |

`pressline-conformance` from `@pressline/conformance` remains as an alias of `engine conformance`.
