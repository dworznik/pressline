import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { FetchHttpClient } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { specHash, type PrintfileSpec } from '@pressline/contract'
import { Effect, Layer } from 'effect'
import { beforeAll, describe, expect, it } from 'vitest'
import { gama, phys, pixelsPerMeter, png, srgb, trns } from '../../contract/tests/image-bytes.js'
import { cli } from '../src/cli.js'
import { Output } from '../src/output.js'

/**
 * `pressline engine preflight` at the seam an Engine developer uses: paths and
 * a Spec in, a report and an exit code out. No instance is reached; the Spec
 * comes from `--spec`, which is the path a developer takes before there is an
 * instance to ask.
 */
const spec: PrintfileSpec = {
  width: 1800,
  height: 2400,
  dpi: 150,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
}

const run = async (args: string[]) => {
  const lines: string[] = []
  const layer = Layer.mergeAll(
    NodeContext.layer,
    FetchHttpClient.layer,
    Layer.succeed(Output, { line: (text) => Effect.sync(() => void lines.push(text)) }),
  )
  const exit = await Effect.runPromiseExit(
    cli(['node', 'pressline', ...args]).pipe(Effect.provide(layer)),
  )
  return {
    lines,
    out: lines.join('\n'),
    error: exit._tag === 'Failure' ? String(exit.cause) : undefined,
  }
}

let dir = ''
let specFile = ''
let groupFile = ''
let hash = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pressline-preflight-'))
  hash = await Effect.runPromise(specHash(spec))
  specFile = join(dir, 'spec.json')
  groupFile = join(dir, 'group.json')
  await writeFile(specFile, JSON.stringify(spec))
  await writeFile(
    groupFile,
    JSON.stringify({ specHash: hash, spec, variants: [{ key: 'black-m', label: 'Black / M' }] }),
  )
  await mkdir(join(dir, 'files'))
  await mkdir(join(dir, 'files', 'nested'))
  const conformant = png({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(150)), trns)
  await writeFile(join(dir, 'files', 'front.png'), conformant)
  await writeFile(join(dir, 'files', 'back.PNG'), png({ colorType: 6 }, trns))
  await writeFile(
    join(dir, 'files', 'small.png'),
    png({ colorType: 6, width: 1200, height: 1600 }, srgb, gama, phys(pixelsPerMeter(150)), trns),
  )
  await writeFile(join(dir, 'files', '.hidden.png'), conformant)
  await writeFile(join(dir, 'files', 'notes.txt'), 'not an image')
  await writeFile(join(dir, 'files', 'nested', 'deep.png'), conformant)
})

describe('pressline engine preflight', () => {
  it('checks a directory of images, unrecursed, without the hidden or the non-image files', async () => {
    const r = await run(['engine', 'preflight', join(dir, 'files'), '--spec', specFile])
    expect(r.out).toContain('front.png')
    expect(r.out).toContain('back.PNG')
    expect(r.out).toContain('small.png')
    expect(r.out).not.toContain('.hidden.png')
    expect(r.out).not.toContain('notes.txt')
    expect(r.out).not.toContain('deep.png')
    expect(r.lines.filter((l) => l.startsWith('Spec'))).toHaveLength(1)
    expect(r.lines.at(-1)).toBe('3 files against 1 Spec: 1 refused, 1 with Deviations, 1 clean.')
    expect(r.error).toContain('1 of 3')
  })

  it('checks a path named explicitly whatever it is called', async () => {
    const r = await run([
      'engine',
      'preflight',
      join(dir, 'files', 'notes.txt'),
      '--spec',
      specFile,
    ])
    expect(r.out).toContain('✗ header: not a readable PNG or JPEG header')
    expect(r.error).toBeDefined()
  })

  it('recomputes the Spec Hash of a bare Spec, and trusts the one a group carries', async () => {
    const bare = await run([
      'engine',
      'preflight',
      join(dir, 'files', 'front.png'),
      '--spec',
      specFile,
    ])
    expect(bare.lines[0]).toBe(
      `Spec: 1800×2400px @ 150 dpi, png, alpha allowed (hash ${hash.slice(0, 12)}…)`,
    )
    expect(bare.error).toBeUndefined()
    const group = await run([
      'engine',
      'preflight',
      join(dir, 'files', 'front.png'),
      '--spec',
      groupFile,
    ])
    expect(group.lines[0]).toContain(`(hash ${hash.slice(0, 12)}…)`)
  })

  it('passes a file with Deviations, and fails the same file under --strict', async () => {
    const args = ['engine', 'preflight', join(dir, 'files', 'back.PNG'), '--spec', specFile]
    const lax = await run(args)
    expect(lax.out).toContain('✓ nothing Validation would refuse')
    expect(lax.out).toContain('⚠ dpi_missing:')
    expect(lax.error).toBeUndefined()
    const strict = await run([...args, '--strict'])
    expect(strict.error).toContain('--strict')
  })

  it('says so, and checks only the file, when no Spec is given', async () => {
    const r = await run(['engine', 'preflight', join(dir, 'files', 'small.png')])
    expect(r.lines[0]).toBe('no Spec: dimensions, alpha and DPI not checked')
    expect(r.out).toContain('✓ nothing Validation would refuse')
    expect(r.error).toBeUndefined()
  })

  it('prints the Spec Hash, the header and the two tiers apart as JSON', async () => {
    const r = await run([
      'engine',
      'preflight',
      join(dir, 'files', 'small.png'),
      '--spec',
      specFile,
      '--json',
    ])
    const json = JSON.parse(r.out) as {
      checks: Array<{
        path: string
        specHash: string
        header: { width: number }
        invalid: Array<{ reason: string }>
        deviations: Array<{ code: string }>
      }>
    }
    expect(json.checks).toHaveLength(1)
    expect(json.checks[0]!.specHash).toBe(hash)
    expect(json.checks[0]!.header.width).toBe(1200)
    expect(json.checks[0]!.invalid.map((i) => i.reason)).toEqual(['dimensions'])
    expect(json.checks[0]!.deviations).toEqual([])
  })

  it('reads a Spec from stdin, the way `pressline offers --json | jq` hands one over', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!
    Object.defineProperty(process, 'stdin', {
      value: Readable.from([Buffer.from(JSON.stringify(spec))]),
      configurable: true,
    })
    try {
      const r = await run(['engine', 'preflight', join(dir, 'files', 'front.png'), '--spec', '-'])
      expect(r.lines[0]).toContain(`(hash ${hash.slice(0, 12)}…)`)
      expect(r.error).toBeUndefined()
    } finally {
      Object.defineProperty(process, 'stdin', original)
    }
  })

  it('refuses to guess when --spec and --offer are both given', async () => {
    const r = await run([
      'engine',
      'preflight',
      join(dir, 'files', 'front.png'),
      '--spec',
      specFile,
      '--offer',
      'tee-black-front',
    ])
    expect(r.error).toContain('either --spec or --offer')
  })
})
