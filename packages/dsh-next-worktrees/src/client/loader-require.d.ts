/**
 * Ambient declaration for the loader-provided require.
 *
 * The shared tsdown preset wraps this plugin's whole client bundle in
 * `window.__ModuleLoader__.load({ factory: (require) => {...} })`, so at
 * runtime a `require` parameter is in scope for every module in the
 * bundle. TypeScript cannot see the banner, hence this declaration. The
 * derived official workspace browser resolves its platform dependencies
 * through exactly this require.
 */
declare const require: (specifier: string) => unknown
