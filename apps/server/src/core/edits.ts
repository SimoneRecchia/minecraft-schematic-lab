import type {
  BuildOperation,
  BuildSpec,
  CircuitDefinition,
  CircuitIo,
  CircuitTest,
  Component,
  PaletteEntry,
} from '@minecraft-schematic-lab/build-spec';

/** High-level edits on a spec, addressed by operation ids instead of array indices. */
export type Edit =
  | { op: 'add'; operations: BuildOperation[]; after?: string; before?: string; into?: string }
  | { op: 'replace'; id: string; with: BuildOperation }
  | { op: 'update'; id: string; set: Record<string, unknown> }
  | { op: 'remove'; ids: string[] }
  | { op: 'palette'; set: Record<string, PaletteEntry | null> }
  | { op: 'component'; name: string; set: Component | null }
  | {
      op: 'meta';
      set: Partial<
        Pick<BuildSpec, 'name' | 'description' | 'minecraftVersion' | 'anchor' | 'seed' | 'size'>
      >;
    }
  | {
      op: 'circuit';
      /** Merged by name; null removes an input, output or test. */
      set: {
        inputs?: Record<string, CircuitIo | null>;
        outputs?: Record<string, CircuitIo | null>;
        tests?: (CircuitTest | { name: string; remove: true })[];
        settleTicks?: number | null;
      } | null;
    };

export class EditError extends Error {}

interface Location {
  list: BuildOperation[];
  index: number;
}

/** Find an operation by id anywhere: top level, nested groups, or inside components. */
function locate(spec: BuildSpec, id: string): Location | null {
  const search = (list: BuildOperation[]): Location | null => {
    for (let i = 0; i < list.length; i++) {
      const op = list[i] as BuildOperation;
      if (op.id === id) return { list, index: i };
      if (op.type === 'group') {
        const hit = search(op.operations);
        if (hit) return hit;
      }
    }
    return null;
  };
  const top = search(spec.operations);
  if (top) return top;
  for (const comp of Object.values(spec.components ?? {})) {
    const hit = search(comp.operations);
    if (hit) return hit;
  }
  return null;
}

function allIds(spec: BuildSpec): string[] {
  const ids: string[] = [];
  const walk = (list: BuildOperation[]) => {
    for (const op of list) {
      if (op.id) ids.push(op.id);
      if (op.type === 'group') walk(op.operations);
    }
  };
  walk(spec.operations);
  for (const c of Object.values(spec.components ?? {})) walk(c.operations);
  return ids;
}

function need(spec: BuildSpec, id: string): Location {
  const loc = locate(spec, id);
  if (!loc) {
    const ids = allIds(spec);
    throw new EditError(
      `No operation with id "${id}".${ids.length ? ` Known ids: ${ids.slice(0, 60).join(', ')}` : ' Operations have no ids; use patch or add ids.'}`,
    );
  }
  return loc;
}

/** Apply edits to a deep copy of the spec. Throws EditError with a precise message. */
export function applyEdits(input: BuildSpec, edits: Edit[]): BuildSpec {
  const spec = structuredClone(input);
  for (const edit of edits) {
    switch (edit.op) {
      case 'add': {
        if (edit.after || edit.before) {
          const loc = need(spec, (edit.after ?? edit.before) as string);
          loc.list.splice(loc.index + (edit.after ? 1 : 0), 0, ...edit.operations);
        } else if (edit.into) {
          const loc = need(spec, edit.into);
          const target = loc.list[loc.index] as BuildOperation;
          if (target.type !== 'group') throw new EditError(`"${edit.into}" is not a group.`);
          target.operations.push(...edit.operations);
        } else {
          spec.operations.push(...edit.operations);
        }
        break;
      }
      case 'replace': {
        const loc = need(spec, edit.id);
        loc.list[loc.index] = edit.with;
        break;
      }
      case 'update': {
        const loc = need(spec, edit.id);
        const merged = { ...(loc.list[loc.index] as object) } as Record<string, unknown>;
        for (const [k, v] of Object.entries(edit.set)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        loc.list[loc.index] = merged as unknown as BuildOperation;
        break;
      }
      case 'remove': {
        for (const id of edit.ids) {
          const loc = need(spec, id);
          loc.list.splice(loc.index, 1);
        }
        break;
      }
      case 'palette': {
        spec.palette ??= {};
        for (const [k, v] of Object.entries(edit.set)) {
          if (v === null) delete spec.palette[k];
          else spec.palette[k] = v;
        }
        break;
      }
      case 'component': {
        spec.components ??= {};
        if (edit.set === null) delete spec.components[edit.name];
        else spec.components[edit.name] = edit.set;
        break;
      }
      case 'meta': {
        Object.assign(spec, edit.set);
        break;
      }
      case 'circuit': {
        if (edit.set === null) {
          delete spec.circuit;
          break;
        }
        const c: CircuitDefinition = { ...(spec.circuit ?? {}) };
        for (const key of ['inputs', 'outputs'] as const) {
          const patch = edit.set[key];
          if (!patch) continue;
          const merged: Record<string, CircuitIo> = { ...(c[key] ?? {}) };
          for (const [name, io] of Object.entries(patch)) {
            if (io === null) delete merged[name];
            else merged[name] = io;
          }
          c[key] = merged;
        }
        if (edit.set.tests) {
          const tests = [...(c.tests ?? [])];
          for (const t of edit.set.tests) {
            const k = tests.findIndex((x) => x.name === t.name);
            if ('remove' in t) {
              if (k < 0) throw new EditError(`circuit: no test named "${t.name}" to remove.`);
              tests.splice(k, 1);
            } else if (k >= 0) tests[k] = t;
            else tests.push(t);
          }
          c.tests = tests;
        }
        if (edit.set.settleTicks !== undefined) {
          if (edit.set.settleTicks === null) delete c.settleTicks;
          else c.settleTicks = edit.set.settleTicks;
        }
        spec.circuit = c;
        break;
      }
      default:
        throw new EditError(`Unknown edit op "${(edit as { op: string }).op}".`);
    }
  }
  return spec;
}
