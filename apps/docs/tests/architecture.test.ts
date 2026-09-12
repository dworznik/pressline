import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { LikeC4 } from 'likec4'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * House rules for the architecture model in docs/architecture (ticket #67).
 * `likec4 validate` is the syntax gate; this suite checks what the DSL cannot:
 * that the model keeps naming the workspaces, linking the ADRs it encodes,
 * giving every container and component a technology, and never spelling a
 * domain name. Failures are soft so one run reports every violation.
 */
const repo = resolve(import.meta.dirname, '../../..')
const workspace = resolve(repo, 'docs/architecture')

const dirs = (rel: string) =>
  readdirSync(resolve(repo, rel), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

/** The ADRs the map said the diagrams must not contradict; each must be linked from some element. */
const MUST_LINK = ['0002', '0003', '0004', '0007', '0008', '0009', '0011', '0012', '0013', '0014']

const DOMAIN_NAMES = [/pressline\.dev/i, /pressline\.store/i]

type Model = Awaited<ReturnType<LikeC4['computedModel']>>
let model: Model

beforeAll(async () => {
  const likec4 = await LikeC4.fromWorkspace(workspace, { logger: false, throwIfInvalid: true })
  model = await likec4.computedModel()
})

const text = (rich: { readonly text: string } | { readonly isEmpty: true }) =>
  'text' in rich ? rich.text : ''

const workspaceNames = (el: { metadata: Record<string, string | string[]> }) => {
  const w = el.metadata['workspace']
  return w === undefined ? [] : Array.isArray(w) ? w : [w]
}

describe('architecture model', () => {
  it('names every workspace: apps/* as a container metadata.workspace, packages/* in a title or metadata', () => {
    const elements = [...model.elements()]
    const relationships = [...model.relationships()]
    const named = new Set(elements.flatMap(workspaceNames))
    for (const app of dirs('apps')) {
      expect
        .soft(named.has(app), `apps/${app} has no element with metadata { workspace '${app}' }`)
        .toBe(true)
    }
    const titles = relationships.map((r) => r.title ?? '')
    for (const pkg of dirs('packages')) {
      // A whole-word mention: "@pressline/render" counts, "renders" does not.
      const word = new RegExp(`(^|[^A-Za-z0-9-])${pkg}([^A-Za-z0-9-]|$)`)
      const mentioned = named.has(pkg) || titles.some((t) => word.test(t))
      expect
        .soft(mentioned, `packages/${pkg} is named in no relationship title or element metadata`)
        .toBe(true)
    }
  })

  it('links ADRs that exist and covers the must-not-contradict list', () => {
    const adrFiles = readdirSync(resolve(repo, 'docs/adr'))
    const linked = new Set<string>()
    for (const el of model.elements()) {
      for (const link of el.links) {
        const m = /^ADR-(\d{4})$/.exec(link.title ?? '')
        if (!m) continue
        const file = link.url.split('/').at(-1) ?? ''
        expect
          .soft(
            existsSync(resolve(repo, 'docs/adr', file)),
            `${el.id}: ${link.title} points at a missing file ${file}`,
          )
          .toBe(true)
        expect
          .soft(
            file.startsWith(m[1]!),
            `${el.id}: ${link.title} points at ${file}, a different ADR`,
          )
          .toBe(true)
        linked.add(m[1]!)
      }
    }
    for (const n of MUST_LINK) {
      expect
        .soft(
          adrFiles.some((f) => f.startsWith(n)),
          `docs/adr has no ADR-${n}`,
        )
        .toBe(true)
      expect.soft(linked.has(n), `ADR-${n} is linked from no element`).toBe(true)
    }
  })

  it('gives every container and component a technology', () => {
    for (const el of model.elements()) {
      if (el.kind !== 'container' && el.kind !== 'component') continue
      expect.soft(el.technology, `${el.id} has no technology`).toBeTruthy()
    }
  })

  it('never spells a domain name in a title or description', () => {
    const check = (what: string, s: string) => {
      for (const re of DOMAIN_NAMES) {
        expect.soft(re.test(s), `${what} contains a domain name`).toBe(false)
      }
    }
    for (const el of model.elements()) {
      check(`element ${el.id} title`, el.title)
      check(`element ${el.id} description`, text(el.description))
    }
    for (const view of model.views()) {
      check(`view ${view.id} title`, view.title ?? '')
      check(`view ${view.id} description`, text(view.description))
    }
  })
})
