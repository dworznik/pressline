# @pressline/cli

The Operator's command line for one Pressline instance. Every command is a client of the operator API; the CLI never touches the database or the providers directly.

```sh
npx @pressline/cli --url https://shop.example --token $OPERATOR_TOKEN doctor
```

`--url` and `--token` can come from `PRESSLINE_URL` and `PRESSLINE_TOKEN`.

| Command                                                                                                         | What it does                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`                                                                                                        | Config, secrets, each Engine's health, webhook registration; exits 1 with the list of problems                                            |
| `catalogue search <text>`                                                                                       | Provider products matching the words, with variants, Printfile Specs and an Offer snippet for `pressline.config.ts`                       |
| `catalogue check`                                                                                               | Every configured Offer resolves at the provider                                                                                           |
| `webhooks register [--public-url]`                                                                              | Create or verify the Stripe and Printful endpoints; prints the secrets to store (shown once)                                              |
| `orders list [--state] [--limit]`                                                                               | Orders, newest first                                                                                                                      |
| `orders show <id>`                                                                                              | One Order with Transitions, Inbound Events and emails                                                                                     |
| `orders create --engine --design --offer --variant --paid-outside --name --address1 --city --country --email …` | An Order paid outside Stripe (reprint, offline sale): Printfile ensured, submitted to the provider; `--send-email` sends the confirmation |
| `orders resubmit <id>`                                                                                          | Submit again from `submit_failed`; re-confirm an `on_hold` provider order                                                                 |
| `orders fix-address <id> --name --address1 …`                                                                   | Replace the Recipient (same country), fix it at the provider, resubmit                                                                    |
| `orders cancel <id>`                                                                                            | Cancel at the provider when it still can, record `cancelled`; never refunds                                                               |
| `orders purge --older-than <days>`                                                                              | Strip Recipient and consent from terminal Orders untouched that long; country and totals stay                                             |
| `reconcile [--dry-run]`                                                                                         | Run Reconciliation now; dry run reports without repairing                                                                                 |
| `printfile check <url> --offer --variant`                                                                       | Compare any image URL with the Spec of an Offer variant                                                                                   |
