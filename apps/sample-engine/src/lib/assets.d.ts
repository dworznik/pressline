/** Vite inlines the bundled font as a data URI (`?inline`); the module resolves to that string. */
declare module '*.ttf?inline' {
  const dataUri: string
  export default dataUri
}
