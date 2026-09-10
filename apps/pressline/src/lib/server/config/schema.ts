import { Context, Effect, Layer, Schema } from 'effect';

/**
 * Operator configuration (ADR-0014): a typed file in the deployed repo,
 * validated at boot. Secrets are NOT here; they come from the platform env.
 * Later tickets extend this (Catalogue in #4, branding in #19, legal in #8).
 */
export const EngineConfig = Schema.Struct({
  slug: Schema.String.pipe(Schema.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
  baseUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//)),
});
export type EngineConfig = typeof EngineConfig.Type;

export const PresslineConfigSchema = Schema.Struct({
  /** Shown on the Storefront and in emails. */
  name: Schema.NonEmptyString,
  /** ISO 4217, one per instance (ADR-0015). */
  currency: Schema.String.pipe(Schema.pattern(/^[A-Z]{3}$/)),
  /** Trusted Engines wired to this instance (ADR-0001). */
  engines: Schema.Array(EngineConfig).pipe(Schema.minItems(1)),
  /** Demo Mode: no money and no goods move. */
  demo: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});
export type PresslineConfig = typeof PresslineConfigSchema.Type;

export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}

/** Decode a raw config object; fails boot with a readable message. */
export const decodeConfig = (raw: unknown): Effect.Effect<PresslineConfig, ConfigError> =>
  Schema.decodeUnknown(PresslineConfigSchema)(raw).pipe(
    Effect.mapError(
      (e) => new ConfigError({ message: `pressline.config.ts is invalid:\n${e.message}` }),
    ),
  );

export class Config extends Context.Tag('pressline/Config')<Config, PresslineConfig>() {
  static readonly layer = (raw: unknown) => Layer.effect(Config, decodeConfig(raw));
}

/** Helper for config authors: `export default defineConfig({...})`. */
export const defineConfig = (config: typeof PresslineConfigSchema.Encoded) => config;
