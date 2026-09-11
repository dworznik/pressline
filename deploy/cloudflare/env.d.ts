// SvelteKit writes `_worker.js` at build time; declare its shape so the shim
// typechecks without a prior build.
declare module '*/_worker.js' {
  const app: unknown;
  export default app;
}
