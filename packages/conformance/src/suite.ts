import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform';
import {
  makeEngineClient,
  PROTOCOL_VERSION,
  specHash,
  validatePrintfile,
  type DesignResponse,
  type PrintfileReady,
  type PrintfileSpec,
} from '@pressline/contract';
import { Duration, Effect, Layer, Schedule } from 'effect';

/**
 * The DesignSource conformance suite (ticket #21): one Engine, one Design ID,
 * every rule of the protocol exercised the way Pressline exercises it. The
 * header check is Pressline's own `validatePrintfile`, so the two cannot
 * disagree.
 */
export interface ConformanceOptions {
  readonly baseUrl: string;
  readonly secret: string;
  readonly designId: string;
  /** DPI for the Spec the suite asks for; the size follows the Design's aspect. Default 150. */
  readonly dpi?: number;
  /** Longest wait for a rendering Engine. Default 60 s. */
  readonly renderTimeout?: Duration.DurationInput;
  /** A fetch to use instead of the global one (tests, custom agents). */
  readonly fetch?: typeof globalThis.fetch;
}

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ConformanceReport {
  readonly ok: boolean;
  readonly checks: ReadonlyArray<Check>;
}

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail });
const failed = (name: string, detail: string): Check => ({ name, ok: false, detail });

/** A Spec that fits the Design: 1200 px on the short side at the requested DPI, PNG with alpha allowed. */
export const specFor = (design: DesignResponse, dpi: number): PrintfileSpec => {
  const ratio = design.aspect.w / design.aspect.h;
  const width = ratio >= 1 ? Math.round(1200 * ratio) : 1200;
  const height = ratio >= 1 ? 1200 : Math.round(1200 / ratio);
  return {
    width,
    height,
    dpi,
    formats: ['png'],
    colorSpace: 'srgb',
    alpha: 'allowed',
    placement: 'front',
    technique: 'dtg',
  };
};

/** A Spec no Design can honour: an aspect of 100:1. */
export const impossibleSpec = (dpi: number): PrintfileSpec => ({
  width: 4000,
  height: 40,
  dpi,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
});

const describe = (e: unknown) =>
  typeof e === 'object' && e !== null && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e);

export const runConformance = (options: ConformanceOptions) =>
  Effect.gen(function* () {
    const dpi = options.dpi ?? 150;
    const checks: Check[] = [];
    const client = yield* makeEngineClient({ baseUrl: options.baseUrl, secret: options.secret });
    const http = yield* HttpClient.HttpClient;

    // 1. /health
    const health = yield* client.health.health().pipe(Effect.either);
    if (health._tag === 'Left') {
      checks.push(failed('health', `GET /health failed: ${describe(health.left)}`));
      return { ok: false, checks };
    }
    checks.push(
      health.right.protocolVersion === PROTOCOL_VERSION
        ? pass('health', `protocol version ${health.right.protocolVersion}`)
        : failed(
            'health',
            `protocol version ${health.right.protocolVersion}, this suite speaks ${PROTOCOL_VERSION}`,
          ),
    );

    // 2. Design metadata
    const design = yield* client.designs
      .getDesign({ path: { designId: options.designId } })
      .pipe(Effect.either);
    if (design._tag === 'Left') {
      checks.push(
        failed('design', `GET /designs/${options.designId} failed: ${describe(design.left)}`),
      );
      return { ok: false, checks };
    }
    const d = design.right;
    checks.push(
      pass(
        'design',
        `"${d.title ?? d.id}" ${d.sellable ? 'sellable' : 'not sellable'}, aspect ${d.aspect.w}:${d.aspect.h}`,
      ),
    );

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
      );
    checks.push(
      preview._tag === 'Right' && preview.right >= 200 && preview.right < 300
        ? pass('preview', `${d.previewUrl} answers ${preview.right}`)
        : failed(
            'preview',
            `${d.previewUrl}: ${preview._tag === 'Right' ? `HTTP ${preview.right}` : describe(preview.left)}`,
          ),
    );

    // 4. Render: immediate 200, or 202 then 200 within the timeout
    const spec = specFor(d, dpi);
    const hash = yield* specHash(spec);
    const ensure = () =>
      client.designs.ensurePrintfile({ path: { designId: d.id }, payload: spec });
    const first = yield* ensure().pipe(Effect.either);
    let ready: PrintfileReady | undefined;
    if (first._tag === 'Left') {
      checks.push(failed('render', `POST /printfile failed: ${describe(first.left)}`));
    } else if (first.right.status === 'ready') {
      ready = first.right;
      checks.push(pass('render', 'answered 200 ready at once'));
    } else {
      const retryAfter = first.right.retryAfterMs;
      const polled = yield* ensure().pipe(
        Effect.flatMap((r) =>
          r.status === 'ready' ? Effect.succeed(r) : Effect.fail({ message: 'still rendering' }),
        ),
        Effect.retry({
          schedule: Schedule.spaced(Duration.millis(Math.max(250, retryAfter))),
          while: (e) => e.message === 'still rendering',
        }),
        Effect.timeoutOption(options.renderTimeout ?? Duration.seconds(60)),
        Effect.either,
      );
      if (polled._tag === 'Right' && polled.right._tag === 'Some') {
        ready = polled.right.value;
        checks.push(pass('render', `answered 202 (retry after ${retryAfter} ms), then 200 ready`));
      } else {
        checks.push(
          failed(
            'render',
            polled._tag === 'Left'
              ? `polling failed: ${describe(polled.left)}`
              : 'still rendering when the timeout ran out',
          ),
        );
      }
    }

    if (ready) {
      // 5. Idempotent on (Design ID, Spec Hash)
      const again = yield* ensure().pipe(Effect.either);
      const same =
        again._tag === 'Right' &&
        again.right.status === 'ready' &&
        again.right.url === ready.url &&
        again.right.specHash === ready.specHash;
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
      );

      // 6. The file itself, checked exactly as Pressline checks it
      const valid = yield* validatePrintfile(ready, spec, hash).pipe(Effect.either);
      checks.push(
        valid._tag === 'Right'
          ? pass(
              'printfile',
              `${ready.url}: ${spec.width}×${spec.height} ${ready.contentType}, ${ready.bytes} bytes`,
            )
          : failed('printfile', `${valid.left.reason}: ${valid.left.message}`),
      );
    }

    // 7. An impossible Spec is refused with 422
    const rejected = yield* client.designs
      .ensurePrintfile({ path: { designId: d.id }, payload: impossibleSpec(dpi) })
      .pipe(Effect.either);
    checks.push(
      rejected._tag === 'Left' && rejected.left._tag === 'PrintfileRejected'
        ? pass('rejects', `422 ${rejected.left.code}: ${rejected.left.message}`)
        : failed(
            'rejects',
            rejected._tag === 'Right'
              ? `answered ${rejected.right.status} to a 100:1 Spec instead of 422 PrintfileRejected`
              : `answered ${describe(rejected.left)} instead of 422 PrintfileRejected`,
          ),
    );

    return { ok: checks.every((c) => c.ok), checks } satisfies ConformanceReport;
  }).pipe(
    Effect.provide(
      options.fetch
        ? FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch)),
          )
        : FetchHttpClient.layer,
    ),
  );

/** Promise form for test helpers and scripts. Throws only on a misconfiguration (e.g. an insecure base URL). */
export const conformance = (options: ConformanceOptions): Promise<ConformanceReport> =>
  Effect.runPromise(runConformance(options));

export const formatReport = (report: ConformanceReport): string =>
  [
    ...report.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name.padEnd(11)} ${c.detail}`),
    report.ok ? 'Conformant.' : `${report.checks.filter((c) => !c.ok).length} check(s) failed.`,
  ].join('\n');
