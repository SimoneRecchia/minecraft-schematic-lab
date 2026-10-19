/**
 * Behaviour that changed between Java releases. Block availability is the catalog's job; these
 * are the mechanics that work differently on the same blocks.
 */
export interface RedstoneRules {
  /** Release the rules describe, e.g. "1.12.2". */
  version: string;
  /**
   * 1.8–1.12: dust loses one level per update while it depowers (the old recursive algorithm);
   * 1.13+: it jumps straight to its new level.
   */
  incrementalDust: boolean;
  /**
   * 1.8–1.15: which sides dust powers is worked out live from its neighbours (a lone dust powers
   * all four sides). 1.16+: from its stored shape — a dot powers no side, a cross all four.
   */
  liveDustSides: boolean;
  /** 1.13+: torches and diodes skip rescheduling when their tick already runs this tick. */
  tickThisTickCheck: boolean;
  /** 1.19+: neighbour updates are queued (depth-first) instead of nested Java calls. */
  queuedUpdates: boolean;
  /** 1.13+: note blocks store `powered` in the block, so a change updates their neighbours. */
  noteBlockState: boolean;
  /** 1.8–1.12: note blocks have a block entity, so pistons can't move them. */
  noteBlockImmovable: boolean;
  /** 1.13+: torches, levers, buttons, plates pop off on a shape update (else on neighbour update). */
  shapeSurvival: boolean;
  /**
   * 1.8–1.12: lit and unlit torches, lamps and powered/unpowered diodes are separate blocks, so
   * only the lit/powered one updates its surroundings when placed or removed, and observers
   * don't see states that aren't saved (dust connections, repeater locks).
   */
  splitBlocks: boolean;
  /** 1.14+: dust stays on glass, ice and sea lanterns. */
  dustOnGlass: boolean;
  /** Scheduled ticks run per game tick: 65 536 since 1.9.1, 1 000 before. */
  maxScheduledPerTick: number;
}

function parts(v: string): number[] {
  return v.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** a >= b for release ids ("1.21.4", "26.1"). */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

export function rulesFor(version: string): RedstoneRules {
  const at = (v: string) => versionAtLeast(version, v);
  return {
    version,
    incrementalDust: !at('1.13'),
    liveDustSides: !at('1.16'),
    tickThisTickCheck: at('1.13'),
    queuedUpdates: at('1.19'),
    noteBlockState: at('1.13'),
    noteBlockImmovable: !at('1.13'),
    shapeSurvival: at('1.13'),
    splitBlocks: !at('1.13'),
    dustOnGlass: at('1.14'),
    maxScheduledPerTick: at('1.9.1') ? 65536 : 1000,
  };
}
