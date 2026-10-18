import vm from 'node:vm';
import type { ScriptRunner } from './context';
import { CompileLimitError } from './SparseVolume';

/** API functions called with primitive arguments; every other one gets its arguments as JSON. */
const PRIMITIVE_CALLS = ['set', 'get', 'rand', 'randInt', 'chance', 'noise', 'fbm'];

/** A readable message for anything thrown, without keeping a reference to it. */
function describe(thrown: unknown): string {
  try {
    const message =
      thrown && typeof thrown === 'object' && 'message' in thrown ? thrown.message : thrown;
    return String(message);
  } catch {
    return 'the script threw an unreadable error';
  }
}

/**
 * Runs `script` operation code in a fresh V8 context with a time limit, so a runaway loop cannot
 * hang the server, and without letting it reach Node.
 *
 * The context never receives an object or a function from this realm: those would lead back to the
 * host's `Function` (`fn.constructor('return process')()`). Its API is made of functions created
 * inside the context, which call a single host bridge held in a closure the script cannot see. The
 * bridge takes and returns primitives only (arguments arrive as numbers, strings or JSON) and never
 * throws into the context: a host error becomes an `Error` of the context's own realm. Whatever the
 * script throws is turned into text inside the context, within the time limit. (A promise it leaves
 * rejected is logged by the server's unhandledRejection handler.)
 */
export const nodeScriptRunner: ScriptRunner = (code, api, timeoutMs) => {
  const FAIL = Symbol('fail');
  // Set by the bridge while the script runs.
  const seen: { failure: Error | null; limit: CompileLimitError | null } = {
    failure: null,
    limit: null,
  };

  const bridge = (name: unknown, ...args: unknown[]): unknown => {
    try {
      if (name === '__failure') return seen.failure?.message ?? 'script error';
      const key = String(name);
      const fn = key === 'args' ? undefined : api[key];
      if (typeof fn !== 'function') throw new Error(`${key} is not a function`);
      let values: unknown[];
      if (PRIMITIVE_CALLS.includes(key)) {
        values = args.map((a, i) => (key === 'set' && i === 3 ? String(a) : Number(a)));
      } else {
        const parsed: unknown = typeof args[0] === 'string' ? JSON.parse(args[0]) : null;
        if (!Array.isArray(parsed)) throw new Error(`bad arguments for ${key}`);
        values = parsed;
      }
      const result: unknown = (fn as (...a: unknown[]) => unknown)(...values);
      return result === null || (typeof result !== 'object' && typeof result !== 'function')
        ? result
        : undefined;
    } catch (error) {
      if (error instanceof CompileLimitError) seen.limit ??= error;
      seen.failure = error instanceof Error ? error : new Error(describe(error));
      return FAIL;
    }
  };

  const context = vm.createContext({}, { microtaskMode: 'afterEvaluate' });
  const install = vm.runInContext(
    `(function (bridge, FAIL, primitiveJson, namesJson, argsJson) {
      'use strict';
      const primitive = JSON.parse(primitiveJson);
      const call = (name, args) => {
        const value = primitive.includes(name)
          ? bridge(name, ...args)
          : bridge(name, JSON.stringify(args));
        if (value === FAIL) throw new Error(bridge('__failure'));
        return value;
      };
      for (const name of JSON.parse(namesJson)) {
        globalThis[name] = (...args) => call(name, args);
      }
      globalThis.set = (x, y, z, block) => call('set', [+x, +y, +z, String(block)]);
      globalThis.pick = (list) => list[Math.floor(globalThis.rand() * list.length)];
      globalThis.log = (...parts) => call('log', parts.map(String));
      globalThis.args = JSON.parse(argsJson);
      delete globalThis.Atomics;
      delete globalThis.SharedArrayBuffer;
      delete globalThis.WebAssembly;
    })`,
    context,
  ) as (...a: unknown[]) => void;
  const names = Object.keys(api).filter(
    (k) => /^[A-Za-z_$][\w$]*$/.test(k) && typeof api[k] === 'function',
  );
  install(
    bridge,
    FAIL,
    JSON.stringify(PRIMITIVE_CALLS),
    JSON.stringify(names),
    JSON.stringify(api.args ?? {}),
  );

  // The code is compiled inside the context from a string, never pasted into this wrapper, so it
  // cannot break out of the try: what it throws, syntax errors included, comes back as text.
  context.__source = code;
  const outcome: unknown = (() => {
    try {
      return vm.runInContext(
        `(() => {
          const source = globalThis.__source;
          delete globalThis.__source;
          try {
            new Function("'use strict';\\n" + source)();
            return '';
          } catch (error) {
            try {
              return 'E' + (error && typeof error === 'object' && 'message' in error ? error.message : error);
            } catch {
              return 'Ethe script threw an unreadable error';
            }
          }
        })()`,
        context,
        { timeout: timeoutMs, filename: 'build-script.js' },
      );
    } catch {
      // Only the time limit gets here; its error object is not inspected.
      return `Escript timed out after ${timeoutMs} ms`;
    }
  })();
  if (seen.limit) throw seen.limit;
  if (typeof outcome === 'string' && outcome.startsWith('E')) {
    const message = outcome.slice(1);
    throw seen.failure?.message === message ? seen.failure : new Error(message);
  }
};
