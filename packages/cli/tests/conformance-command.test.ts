import { FetchHttpClient } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import type { ConformanceReport } from '@pressline/conformance'
import type { DesignResponse } from '@pressline/contract'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { fakeEngine } from '../../conformance/tests/fake-engine.js'
import { cli } from '../src/cli.js'
import { Output } from '../src/output.js'

/**
 * `pressline engine conformance` at the seam an Engine developer uses: argv in,
 * a report and an exit code out. The suite's own behaviour is
 * `@pressline/conformance`'s tests; what is asserted here is that every flag
 * reaches it and that the printed form is the one the flag asked for.
 */
const design: DesignResponse = {
  id: 'heron-0001',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
}

const run = async (args: string[], fetch: typeof globalThis.fetch) => {
  const lines: string[] = []
  const layer = Layer.mergeAll(
    NodeContext.layer,
    // The command reads `FetchHttpClient.Fetch` out of its own context and hands
    // it to the suite, which builds its client from it; providing it only *to* a
    // client layer would leave the command with nothing to find. `provideMerge`
    // keeps both in scope, which is what a real run has.
    FetchHttpClient.layer.pipe(Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetch))),
    Layer.succeed(Output, { line: (text) => Effect.sync(() => void lines.push(text)) }),
  )
  const exit = await Effect.runPromiseExit(
    cli(['node', 'pressline', 'engine', 'conformance', 'https://engine.test', ...args]).pipe(
      Effect.provide(layer),
    ),
  )
  return {
    out: lines.join('\n'),
    error: exit._tag === 'Failure' ? String(exit.cause) : undefined,
  }
}

const against = (options: Parameters<typeof fakeEngine>[0]) => fakeEngine(options).fetch
const flags = ['--secret', 's3cret', '--design', design.id]

describe('pressline engine conformance', () => {
  it('passes a conformant Engine and prints the report', async () => {
    const r = await run(flags, against({ design }))
    expect(r.error).toBeUndefined()
    expect(r.out).toContain('✓ printfile')
    expect(r.out).toMatch(/Conformant\.$/)
  })

  it('lists a deviating Engine’s Deviations and still exits 0', async () => {
    const r = await run(flags, against({ design, bareHeader: true }))
    expect(r.error).toBeUndefined()
    expect(r.out).toContain('  ⚠ dpi_missing:')
    expect(r.out).toMatch(/Conformant, with 2 Deviations\.$/)
  })

  it('--strict turns the same Deviations into a failure', async () => {
    const r = await run([...flags, '--strict'], against({ design, bareHeader: true }))
    expect(r.error).toContain('not conformant')
    expect(r.out).toContain('✗ printfile')
    expect(r.out).toMatch(/1 check\(s\) failed\.$/)
  })

  it('--format jpeg asks the Engine for a JPEG', async () => {
    const r = await run([...flags, '--format', 'jpeg'], against({ design }))
    expect(r.error).toBeUndefined()
    expect(r.out).toMatch(/✓ printfile.*\.jpg: jpeg 1200×1600, 8-bit, 3 channel\(s\)/)
  })

  it('--json prints the report as data, Inspection and all', async () => {
    const r = await run([...flags, '--json'], against({ design, bareHeader: true }))
    const report = JSON.parse(r.out) as ConformanceReport
    expect(report.ok).toBe(true)
    expect(report.deviations).toBe(2)
    expect(report.checks.map((c) => c.name)).toContain('printfile')
    const printfile = report.checks.find((c) => c.name === 'printfile')
    expect(printfile?.inspection?.invalid).toEqual([])
    expect(printfile?.inspection?.deviations.map((d) => d.code)).toEqual([
      'color_undeclared',
      'dpi_missing',
    ])
  })
})
