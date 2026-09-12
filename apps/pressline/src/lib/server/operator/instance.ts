import { Context } from 'effect'

/** Facts about this deployment the runtime knows and the health page reports: which Mailer, which secrets are set. */
export interface InstanceFactsValue {
  readonly mailer: string
  readonly secrets: {
    readonly printful: boolean
    readonly stripe: boolean
    readonly stripeWebhook: boolean
    readonly printfulWebhook: boolean
    readonly resend: boolean
    readonly sessionSecret: boolean
    readonly cron: boolean
  }
}

export class InstanceFacts extends Context.Tag('pressline/InstanceFacts')<
  InstanceFacts,
  InstanceFactsValue
>() {}
