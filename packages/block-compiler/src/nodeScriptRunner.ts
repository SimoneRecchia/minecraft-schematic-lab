import vm from 'node:vm';
import type { ScriptRunner } from './context';

/**
 * Runs `script` operation code in a fresh V8 context with only the compile API in scope and a
 * time limit, so a runaway loop cannot hang the server. (Not a security boundary: the code is
 * written by the local assistant, which can already run commands on this machine.)
 */
export const nodeScriptRunner: ScriptRunner = (code, api, timeoutMs) => {
  const sandbox = vm.createContext({
    __api: api,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
  });
  const names = Object.keys(api).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  const wrapped = `(function () {\n"use strict";\nconst { ${names.join(', ')} } = __api;\n${code}\n})();`;
  vm.runInContext(wrapped, sandbox, { timeout: timeoutMs, filename: 'build-script.js' });
};
