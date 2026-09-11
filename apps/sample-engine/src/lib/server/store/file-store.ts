/**
 * Where the Engine keeps what it serves: Previews, Printfiles and Design
 * metadata. Pressline hot-links the URLs and never stores bytes (ADR-0003),
 * so every URL must be public and immutable: a key is written once.
 */
export interface FileStore {
  readonly name: 'fs' | 'r2' | 'blob';
  /** Write once; returns the public URL. Writing an existing key again is a no-op that returns its URL. */
  readonly put: (key: string, bytes: Uint8Array, contentType: string) => Promise<string>;
  readonly get: (key: string) => Promise<Uint8Array | undefined>;
  /** For the Design's metadata only: the record that grows as Printfiles are rendered. */
  readonly overwrite: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  /** The URL a key is (or would be) served at. */
  readonly urlFor: (key: string) => string;
}
