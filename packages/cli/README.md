# @pressline/cli

The command line for one Pressline instance. The Operator's commands are clients of the operator API; the Engine developer's commands (`offers`, `engine …`) read public endpoints or the Engine itself and need no token. The CLI never touches the database or the providers directly.

```sh
npx @pressline/cli --url https://shop.example --token $OPERATOR_TOKEN doctor
npx @pressline/cli --url https://shop.example offers
npx @pressline/cli engine conformance https://engine.example --secret $ENGINE_SECRET --design <id>
npx @pressline/cli --url https://shop.example engine preflight ./out --offer tee-black-front
```

`--url` and `--token` belong to the CLI rather than to a subcommand, so they come first, and can instead come from `PRESSLINE_URL` and `PRESSLINE_TOKEN`. `engine conformance` needs neither; `engine preflight` needs `--url` only when it takes the Spec from an instance.

Preflight is also a function, for an Engine's own test suite: `import { preflight } from '@pressline/cli/preflight'` checks bytes against a Spec without touching the filesystem or the network.

| Command                                                                                                         | What it does                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`                                                                                                        | Config, secrets, each Engine's health, webhook registration; exits 1 with the list of problems                                            |
| `catalog search <text>`                                                                                         | Provider products matching the words, with variants, Printfile Specs and an Offer snippet for `pressline.config.ts`                       |
| `catalog check`                                                                                                 | Every configured Offer resolves at the provider                                                                                           |
| `webhooks register [--public-url]`                                                                              | Create or verify the Stripe and Printful endpoints; prints the secrets to store (shown once)                                              |
| `orders list [--state] [--limit]`                                                                               | Orders, newest first                                                                                                                      |
| `orders show <id>`                                                                                              | One Order with Transitions, Inbound Events and emails                                                                                     |
| `orders create --engine --design --offer --variant --paid-outside --name --address1 --city --country --email …` | An Order paid outside Stripe (reprint, offline sale): Printfile ensured, submitted to the provider; `--send-email` sends the confirmation |
| `orders resubmit <id>`                                                                                          | Submit again from `submit_failed`; re-confirm an `on_hold` provider order                                                                 |
| `orders fix-address <id> --name --address1 …`                                                                   | Replace the Recipient (same country), fix it at the provider, resubmit                                                                    |
| `orders cancel <id>`                                                                                            | Cancel at the provider when it still can, record `canceled`; never refunds                                                                |
| `orders purge --older-than <days>`                                                                              | Strip Recipient and consent from terminal Orders untouched that long; country and totals stay                                             |
| `reconcile [--dry-run]`                                                                                         | Run Reconciliation now; dry run reports without repairing                                                                                 |
| `printfile check <url> --offer --variant`                                                                       | Compare any image URL with the Spec of an Offer variant                                                                                   |
| `offers [--json]`                                                                                               | The Offers the instance sells, one line per distinct Printfile Spec with the variant keys sharing it; no token needed                     |
| `engine conformance <baseUrl> --secret --design [--dpi] [--timeout] [--any-shape]`                              | The DesignSource conformance suite against an Engine; exit 1 when not conformant                                                          |
| `engine preflight <paths…> [--offer --variant \| --spec] [--strict] [--json]`                                   | Preflight local Printfiles against a Spec: what Validation would refuse, and every Deviation; exit 1 on a refusal                         |
