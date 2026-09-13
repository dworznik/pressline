import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import {
  describeHeader,
  formatInspection,
  inspectionFails,
  makeEngineClient,
  PROTOCOL_VERSION,
  specHash,
  validatePrintfile,
  type DesignResponse,
  type Inspection,
  type PrintfileReady,
  type PrintfileSpec,
} from '@pressline/contract'
import { Duration, Effect, Layer } from 'effect'

/**
 * The DesignSource conformance suite (ticket #21): one Engine, one Design ID,
 * every rule of the protocol exercised the way Pressline exercises it. The
 * header check is Pressline's own `validatePrintfile`, so the two cannot
 * disagree.
 */
export interface ConformanceOptions {
  readonly baseUrl: string
  readonly secret: string
  readonly designId: string
  /** DPI for the Spec the suite asks for; the size follows the Design's aspect. Default 150. */
  readonly dpi?: number
  /** The one container the Spec the suite asks for lists. Default `png`. */
  readonly format?: 'png' | 'jpeg'
  /** Longest wait for a rendering Engine. Default 60 s. */
  readonly renderTimeout?: Duration.DurationInput
  /**
   * The Spec the Engine must refuse with 422. Default: a 100:1 aspect, which
   * an Engine that honors its Design's aspect rejects; an Engine that pads
   * anything to any shape may pass `false` to skip the check.
   */
  readonly impossibleSpec?: PrintfileSpec | false
  /** Fail on Deviations too, which is what a developer wants in CI. */
  readonly strict?: boolean
  /** A fetch to use instead of the global one (tests, custom agents). */
  readonly fetch?: typeof globalThis.fetch
}

export interface Check {
  readonly name: string
  readonly ok: boolean
  /** What was seen: the URL and the header line, or the URL alone when nothing was fetched. */
  readonly detail: string
  /**
   * What looking at the Printfile concluded. Only the `printfile` check carries
   * one; its refusals and Deviations print beneath `detail` as the shared block.
   */
  readonly inspection?: Inspection
}

export interface ConformanceReport {
  readonly ok: boolean
  readonly checks: ReadonlyArray<Check>
  /** Deviations the Printfile carries. They are not failures unless `strict` was asked for. */
  readonly deviations: number
  readonly strict: boolean
}

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail })
const failed = (name: string, detail: string): Check => ({ name, ok: false, detail })
/** Not judged: what it depended on failed, or the caller opted out. Counts as ok. */
const skipped = (name: string, detail: string): Check => ({
  name,
  ok: true,
  detail: `skipped: ${detail}`,
})

/** Engines may ask for any polling interval; the suite waits at least a quarter second and at most ten. */
const clampRetry = (ms: number) => Math.min(10_000, Math.max(250, ms))

/**
 * What the container the suite asks for implies. JPEG carries no alpha, so a
 * Spec that lists it forbids transparency — exactly as Pressline's own
 * derivation does.
 */
const shapeOf = (format: 'png' | 'jpeg') =>
  format === 'jpeg'
    ? ({ formats: ['jpeg'], alpha: 'forbidden' } as const)
    : ({ formats: ['png'], alpha: 'allowed' } as const)

/** A Spec that fits the Design: 1200 px on the short side at the requested DPI. */
export const specFor = (
  design: DesignResponse,
  dpi: number,
  format: 'png' | 'jpeg' = 'png',
): PrintfileSpec => {
  const ratio = design.aspect.w / design.aspect.h
  const width = ratio >= 1 ? Math.round(1200 * ratio) : 1200
  const height = ratio >= 1 ? 1200 : Math.round(1200 / ratio)
  return {
    width,
    height,
    dpi,
    ...shapeOf(format),
    colorSpace: 'srgb',
    placement: 'front',
    technique: 'dtg',
  }
}

/**
 * A Spec no Design can honor: an aspect of 100:1. It follows the same container
 * and alpha rule as the Spec above, so the Engine's 422 is about the aspect and
 * nothing else.
 */
export const impossibleSpec = (dpi: number, format: 'png' | 'jpeg' = 'png'): PrintfileSpec => ({
  width: 4000,
  height: 40,
  dpi,
  ...shapeOf(format),
  colorSpace: 'srgb',
  placement: 'front',
  technique: 'dtg',
})

const describe = (e: unknown) =>
  typeof e === 'object' && e !== null && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e)

export const runConformance = (options: ConformanceOptions) =>
  Effect.gen(function* () {
    const dpi = options.dpi ?? 150
    const format = options.format ?? 'png'
    const strict = options.strict ?? false
    const checks: Check[] = []
    /** The verdict, by the same rule all three commands exit on. */
    const report = (): ConformanceReport => {
      const inspection = checks.find((c) => c.inspection)?.inspection
      return {
        ok: checks.every((c) => c.ok),
        checks,
        deviations: inspection?.deviations.length ?? 0,
        strict,
      }
    }
    const client = yield* makeEngineClient({ baseUrl: options.baseUrl, secret: options.secret })
    const http = yield* HttpClient.HttpClient

    // 1. /health
    const health = yield* client.health.health().pipe(Effect.either)
    if (health._tag === 'Left') {
      checks.push(failed('health', `GET /health failed: ${describe(health.left)}`))
      return report()
    }
    checks.push(
      health.right.protocolVersion === PROTOCOL_VERSION
        ? pass('health', `protocol version ${health.right.protocolVersion}`)
        : failed(
            'health',
            `protocol version ${health.right.protocolVersion}, this suite speaks ${PROTOCOL_VERSION}`,
          ),
    )

    // 2. Design metadata
    const design = yield* client.designs
      .getDesign({ path: { designId: options.designId } })
      .pipe(Effect.either)
    if (design._tag === 'Left') {
      checks.push(
        failed('design', `GET /designs/${options.designId} failed: ${describe(design.left)}`),
      )
      return report()
    }
    const d = design.right
    if (d.id !== options.designId) {
      checks.push(
        failed('design', `answered with Design "${d.id}" for /designs/${options.designId}`),
      )
      return report()
    }
    checks.push(
      pass(
        'design',
        `"${d.title ?? d.id}" ${d.sellable ? 'sellable' : 'not sellable'}, aspect ${d.aspect.w}:${d.aspect.h}`,
      ),
    )

    // 3. Preview reachable
    const preview = yield* http
      .execute(
        HttpClientRequest.get(d.previewUrl).pipe(HttpClientRequest.setHeader('Range', 'bytes=0-0')),
      )
      .pipe(
        Effect.timeout(Duration.seconds(10)),
        Effect.map((r) => r.status),
        Effect.scoped,
        Effect.either,
      )
    checks.push(
      preview._tag === 'Right' && preview.right >= 200 && preview.right < 300
        ? pass('preview', `${d.previewUrl} answers ${preview.right}`)
        : failed(
            'preview',
            `${d.previewUrl}: ${preview._tag === 'Right' ? `HTTP ${preview.right}` : describe(preview.left)}`,
          ),
    )

    // 4. Render: immediate 200, or 202 then 200 within the timeout
    const spec = specFor(d, dpi, format)
    const hash = yield* specHash(spec)
    const ensure = () => client.designs.ensurePrintfile({ path: { designId: d.id }, payload: spec })
    const first = yield* ensure().pipe(Effect.either)
    let ready: PrintfileReady | undefined
    if (first._tag === 'Left') {
      checks.push(failed('render', `POST /printfile failed: ${describe(first.left)}`))
    } else if (first.right.status === 'ready') {
      ready = first.right
      checks.push(pass('render', 'answered 200 ready at once'))
    } else {
      // Poll as Pressline does: wait what the Engine asked (clamped), then ask again, until ready or the timeout.
      const firstWait = first.right.retryAfterMs
      const polled = yield* Effect.gen(function* () {
        let wait = clampRetry(firstWait)
        for (;;) {
          yield* Effect.sleep(Duration.millis(wait))
          const next = yield* ensure()
          if (next.status === 'ready') return next
          wait = clampRetry(next.retryAfterMs)
        }
      }).pipe(Effect.timeoutOption(options.renderTimeout ?? Duration.seconds(60)), Effect.either)
      if (polled._tag === 'Right' && polled.right._tag === 'Some') {
        ready = polled.right.value
        checks.push(pass('render', `answered 202 (retry after ${firstWait} ms), then 200 ready`))
      } else {
        checks.push(
          failed(
            'render',
            polled._tag === 'Left'
              ? `polling failed: ${describe(polled.left)}`
              : `still rendering after ${Duration.format(Duration.decode(options.renderTimeout ?? Duration.seconds(60)))}`,
          ),
        )
      }
    }

    if (!ready) {
      checks.push(skipped('idempotent', 'no Printfile to repeat'))
      checks.push(skipped('printfile', 'no Printfile to check'))
    } else {
      // 5. Idempotent on (Design ID, Spec Hash)
      const again = yield* ensure().pipe(Effect.either)
      const same =
        again._tag === 'Right' &&
        again.right.status === 'ready' &&
        again.right.url === ready.url &&
        again.right.specHash === ready.specHash
      checks.push(
        same
          ? pass('idempotent', 'a repeat request returns the same URL and Spec Hash')
          : failed(
              'idempotent',
              again._tag === 'Right'
                ? again.right.status === 'ready'
                  ? `repeat returned ${again.right.url} / ${again.right.specHash.slice(0, 12)}…, first ${ready.url} / ${ready.specHash.slice(0, 12)}…`
                  : 'repeat answered 202 for a Printfile it already made'
                : `repeat failed: ${describe(again.left)}`,
            ),
      )

      // 6. The file itself, inspected exactly as Pressline inspects it
      const looked = yield* validatePrintfile(ready, spec, hash).pipe(Effect.either)
      if (looked._tag === 'Left') {
        // Not a verdict about the file: nobody could read it.
        checks.push(failed('printfile', `${ready.url}: ${looked.left.message}`))
      } else {
        const inspection = looked.right
        checks.push({
          name: 'printfile',
          ok: !inspectionFails(inspection, strict),
          detail: `${ready.url}: ${inspection.header ? describeHeader(inspection.header) : ready.contentType}, ${ready.bytes} bytes`,
          inspection,
        })
      }
    }

    // 7. An impossible Spec is refused with 422
    const impossible =
      options.impossibleSpec === undefined ? impossibleSpec(dpi, format) : options.impossibleSpec
    if (impossible === false) {
      checks.push(skipped('rejects', 'this Engine renders any shape'))
      return report()
    }
    const rejected = yield* client.designs
      .ensurePrintfile({ path: { designId: d.id }, payload: impossible })
      .pipe(Effect.either)
    checks.push(
      rejected._tag === 'Left' && rejected.left._tag === 'PrintfileRejected'
        ? pass('rejects', `422 ${rejected.left.code}: ${rejected.left.message}`)
        : failed(
            'rejects',
            rejected._tag === 'Right'
              ? `answered ${rejected.right.status} to a ${impossible.width}×${impossible.height} Spec instead of 422 PrintfileRejected`
              : `answered ${describe(rejected.left)} instead of 422 PrintfileRejected`,
          ),
    )

    return report()
  }).pipe(
    Effect.provide(
      options.fetch
        ? FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch)),
          )
        : FetchHttpClient.layer,
    ),
  )

/** Promise form for test helpers and scripts. Throws only on a misconfiguration (e.g. an insecure base URL). */
export const conformance = (options: ConformanceOptions): Promise<ConformanceReport> =>
  Effect.runPromise(runConformance(options))

/**
 * The report an Engine developer reads: one line per check, the shared
 * Inspection block beneath the one that has an Inspection, and a last line that
 * is the verdict. A deviating Engine is conformant — the last line says how far
 * it deviates — unless strictness was asked for, and then a Deviation fails.
 */
export const formatReport = (report: ConformanceReport): string =>
  [
    ...report.checks.flatMap((c) => [
      `${c.ok ? '✓' : '✗'} ${c.name.padEnd(11)} ${c.detail}`,
      // The check line's own ✓ already says the file is clean; the block adds what it found.
      ...(c.inspection ? formatInspection(c.inspection, { affirmClean: false }) : []),
    ]),
    report.ok
      ? report.deviations === 0
        ? 'Conformant.'
        : `Conformant, with ${report.deviations} Deviation${report.deviations === 1 ? '' : 's'}.`
      : `${report.checks.filter((c) => !c.ok).length} check(s) failed.`,
  ].join('\n')
