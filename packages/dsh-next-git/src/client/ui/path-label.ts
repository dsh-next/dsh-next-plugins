/** `a/b.ts` -> `b.ts`. */
export function baseName(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? path : path.slice(at + 1)
}
