// Isomorphic id helpers. Use the GLOBAL crypto.randomUUID() (available in Node 22+ and
// browsers) so this module stays browser-safe — importing `node:crypto` here would make the
// web bundle fail (Vite externalizes node builtins).

export function newBuildId(): string {
  return `build_${crypto.randomUUID()}`;
}

export function newSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}
