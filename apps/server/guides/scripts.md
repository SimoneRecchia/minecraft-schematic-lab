# Script operations

`{"type":"script","id":"…","code":"…","args":{…}}` runs JavaScript at compile time. Use it for anything procedural: spirals, rings with crenels, rose windows, organic shapes, noise-driven ruins, rows of houses with variations. It runs inside the current group/component transform, so local coordinates rotate and repeat like everything else.

## API (all in scope)
| | |
|---|---|
| `set(x, y, z, block)` | place one block (palette keys and `[props]` work) |
| `get(x, y, z)` | the block state there (`"minecraft:stone_bricks"`) or `null` for air |
| `box(from, to, block, opts?)`, `line(from, to, block, opts?)` | shortcuts for those operations (`opts` = extra fields like `{walls:true}` or `{radius:1}`) |
| `cylinder({…})`, `cone`, `sphere`, `dome`, `polygon`, `roof`, `arch`, `tree`, `layers`, `terrain`, `scatter`, `replace`, `flatten`, `foundation`, `path` | run that operation with the same fields as in the spec (without `type`) |
| `ground(x, z)`, `surface(x, z)`, `water(x, z)` | y of the top ground block / top block of any kind / water surface at that column, or `null` (the site's ground and what terrain, flatten and path made — read_guide("terrain")) |
| `SITE` | `{min, max}` spec bounds of the site, or `null` without one |
| `place(component, at, opts?)` | place a component (`opts`: `rotate`, `mirror`, `repeat`…) |
| `op({type, …})` | any operation |
| `rand()`, `randInt(a, b)`, `pick(list)`, `chance(p)` | seeded randomness (same spec → same result) |
| `noise(x, y?, z?)`, `fbm(x, y?, z?, octaves?)` | smooth Perlin noise in about [-1, 1] |
| `args` | the operation's `args` object |
| `log(...)` | message shown in the build warnings (debugging) |
`Math`, `JSON`, arrays, loops, functions are available. Time limit: 20 s. Errors are reported with the operation path.

## Patterns
**Spiral staircase** inside a tower of radius r:
```js
const r = args.r, h = args.h;
for (let y = 0; y < h; y++) {
  const a = y * Math.PI / 6;
  for (let k = 1; k <= r - 1; k++) {
    const x = Math.round(Math.cos(a) * k), z = Math.round(Math.sin(a) * k);
    const facing = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.sin(a) > 0 ? 'south' : 'north') : (Math.cos(a) > 0 ? 'west' : 'east');
    set(x, y, z, `stone_brick_stairs[facing=${facing}]`);
  }
  set(0, y, 0, 'stone_bricks');
}
```
**Rose window** (stained glass circle with radial tracery) in the plane z=0:
```js
const R = args.r;
for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
  const d = Math.hypot(x, y); if (d > R + 0.4) continue;
  const ang = Math.atan2(y, x), spoke = Math.abs(Math.sin(ang * 4)) < 0.18;
  set(x, y, 0, d > R - 0.6 || d < 1.5 || spoke ? 'polished_deepslate' : (d < R / 2 ? 'purple_stained_glass' : 'blue_stained_glass'));
}
```
**Ruined wall top** (jagged, noise-driven):
```js
for (let x = 0; x <= args.len; x++) {
  const top = args.h - Math.round(Math.abs(fbm(x / 6, 0.3) * 6));
  for (let y = 0; y <= top; y++) set(x, y, 0, y > top - 2 && chance(0.3) ? 'air' : 'ruin');
}
```
**Village row with variation** (components `house_a`, `house_b`):
```js
let x = 0;
for (let i = 0; i < args.count; i++) {
  const comp = pick(['house_a', 'house_b']);
  place(comp, [x, 0, randInt(0, 2)], { rotate: chance(0.5) ? 0 : 180, mirror: chance(0.5) ? 'x' : undefined });
  x += randInt(9, 12);
}
```
**Organic blob** (rocks, clouds, canopies): `sphere` several times with jittered centres and radii, then `replace` the outer layer with a second block via `chance`.

## Rules
- Prefer real operations for big simple shapes (they're validated field by field); use scripts to orchestrate them and for what operations can't express.
- Keep scripts deterministic (use `rand`/`noise`, not `Math.random`).
- Use palette keys inside scripts too, so palette edits still apply.
