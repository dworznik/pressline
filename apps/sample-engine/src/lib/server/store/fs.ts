import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { FileStore } from './file-store.js'

/** Local development and tests: files under `dir`, served by the app's own `/files/*` route. */
export const fsStore = (dir: string, publicOrigin: string): FileStore => {
  const root = resolve(dir)
  const path = (key: string) => {
    const p = resolve(root, key)
    const rel = relative(root, p)
    // Inside the store's directory, never a sibling that merely shares the prefix.
    if (rel === '' || rel.startsWith('..') || resolve(root, rel) !== p)
      throw new Error(`bad key ${key}`)
    return p
  }
  return {
    name: 'fs',
    urlFor: (key) => `${publicOrigin.replace(/\/$/, '')}/files/${key}`,
    put: async (key, bytes, _contentType) => {
      const p = path(key)
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, bytes, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e // immutable: the first write stands
      })
      return `${publicOrigin.replace(/\/$/, '')}/files/${key}`
    },
    get: (key) =>
      readFile(path(key)).then(
        (b) => new Uint8Array(b),
        () => undefined,
      ),
    overwrite: async (key, bytes) => {
      const p = path(key)
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, bytes)
    },
  }
}
