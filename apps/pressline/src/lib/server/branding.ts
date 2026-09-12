import { Schema } from 'effect'
import { PresslineConfigSchema } from './config/schema'
import { currentConfig } from './runtime'

const config = Schema.decodeUnknownSync(PresslineConfigSchema)(currentConfig())

/** What every Storefront page shows around its content (ticket #19): the Operator's look and legal links. */
export interface Branding {
  readonly name: string
  readonly logoUrl?: string
  readonly faviconUrl?: string
  readonly accent: string
  readonly accentText: string
  readonly tagline?: string
  readonly termsUrl?: string
  readonly privacyUrl?: string
  readonly contactEmail?: string
}

export const getBranding = (): Branding => ({
  name: config.name,
  ...(config.branding.logoUrl ? { logoUrl: config.branding.logoUrl } : {}),
  ...(config.branding.faviconUrl ? { faviconUrl: config.branding.faviconUrl } : {}),
  accent: config.branding.accent,
  accentText: config.branding.accentText,
  ...(config.branding.tagline ? { tagline: config.branding.tagline } : {}),
  ...(config.legal.termsUrl ? { termsUrl: config.legal.termsUrl } : {}),
  ...(config.legal.privacyUrl ? { privacyUrl: config.legal.privacyUrl } : {}),
  ...(config.legal.contactEmail ? { contactEmail: config.legal.contactEmail } : {}),
})
