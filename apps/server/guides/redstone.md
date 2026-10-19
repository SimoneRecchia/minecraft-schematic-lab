# Redstone

VibeSchem simulates Minecraft **Java Edition** redstone the way the game's own code runs it, for the build's `minecraftVersion` (1.8 → newest):
- game ticks;
- neighbour updates in the game's order (west, east, down, up, north, south) and shape updates;
- scheduled ticks ordered by priority;
- block events and moving pistons (slime, honey, the 12-block push limit, sticky pistons dropping blocks on short pulses);
- quasi-connectivity, observers, comparators reading containers, torch burnout.

Treat a circuit like code: **declare its inputs and outputs, write tests, build, read the report, fix, repeat.** The tests run on every `create_build`/`edit_build`, and the summary reports them. Never hand over a circuit whose tests fail.

## Time
- 1 game tick (gt) = 1/20 s. Every number in tests is in game ticks.
- A "redstone tick" = 2 gt. A repeater with `delay=1` waits 2 gt, `delay=4` waits 8 gt.
- A torch waits 2 gt, a comparator 2 gt, an observer 2 gt and then pulses for 2 gt. A lamp turns on at once and off after 4 gt.
- A button stays pressed 20 gt (stone, polished blackstone) or 30 gt (wood).
- A piston's block arrives 2 gt after the piston fires, which is 3 gt after a click.
- Dust has no delay. It loses 1 level per block, from 15, so after 15 dust use a repeater.

## Which way things face (the most common mistake)
| Block | `facing` means | Takes input from | Outputs to |
|---|---|---|---|
| `repeater`, `comparator` | where the **input** is | the block at `facing` | the opposite side |
| `observer` | the side it **watches** | changes of the block at `facing` | the back (opposite side), 2 gt pulse |
| `piston`, `sticky_piston` | the **push** direction | power from any side but the front, or QC | — |
| `redstone_wall_torch` | away from the wall | its wall block (`facing` opposite) | everything else around it, and strong power up |
| `lever`, `*_button` | `face=floor/wall/ceiling`; on a wall, away from the wall | — | strong power into the block it's on |

So a repeater carrying a signal **east** is `repeater[facing=west]`. A torch on the east side of a block is `redstone_wall_torch[facing=east]`.

## Power, in one paragraph
- **Strong power**: from levers and buttons into their block, from torches into the block above them, and from repeaters, comparators and observers into the block in front of them. A strongly powered block powers everything around it, dust included.
- **Weak power**: dust powers the block under it and the block it points at. A weakly powered block powers lamps, pistons, repeaters and comparators facing away from it, but never dust.
- Conductive: opaque full blocks, plus slime, soul sand and mud. Not conductive:
  - glass, leaves, ice (packed and blue ice do conduct);
  - glowstone, sea lantern, TNT;
  - redstone block, observer, piston;
  - copper bulb, honey, slabs, stairs.

## Dust
- Dust connects to wire, to every power source, to repeaters along their axis, and to an observer's output. A line points on into the blocks at its ends.
- A lone dust is a "+" that powers all four sides. From 1.16 a dot (`redstone_wire[north=none,south=none,east=none,west=none]`) powers no side. Dust shapes are worked out for you, like placing it by hand; write them only for a dot.
- Dust climbs onto blocks and steps down from them. A conductive block directly above the step cuts it. It can't go down off glass or a top slab: that makes a one-way path.
- Two parallel lines next to each other merge. Keep a gap, or carry one with repeaters, which never connect sideways.

## Quasi-connectivity (pistons, droppers, dispensers)
Anything that powers the space **above** a piston also powers the piston, but it only notices on its next block update. Test doors and flying parts with the `"read": "block"` output and `settle`. Run `simulate` with `locations` when the design depends on update order.

## The `circuit` section
```
"circuit": {
  "inputs":  { "A": {"at": [0,0,0]}, "B": {"at": [[0,0,2],[0,0,4],[0,0,6]]}, "K": {"at": [9,1,0], "as": "redstone_block"} },
  "outputs": { "Q": {"at": [7,0,1]}, "S": {"at": [[10,0,0],[10,0,2]]}, "L": {"at": [5,0,3], "read": "power"} },
  "tests":   [ {"name": "…", "steps": [ … ]} ],
  "settleTicks": 1200
}
```
**Inputs**
- An input is a lever (set 0/1) or a button (`press` it).
- A pressure plate takes a value: entities on it, counted on weighted plates.
- A target block takes a value too: the power of a hit, lasting 20 gt.
- So does a daylight detector or a sculk sensor: the power it outputs.
- With `"as": "redstone_block"` (or any block), 1 places that block there and 0 puts back what was there.

**Outputs**
- An output reads the natural "on" of its block:
  - lit, for a lamp, torch or bulb;
  - extended, for a piston;
  - open, for a door;
  - power > 0, for dust;
  - powered, for a repeater or an observer;
  - locked, for a hopper;
  - powered, for any other block.
- `"read": "power"` gives 0–15. `"read": "block"` gives 1 when a block stands there, for doors and moving parts.

**Buses.** A list of positions is a bus, bit 0 first. It reads and writes as an integer: `{"set": {"B": 5}}`, `{"expect": {"S": 6}}`.

Coordinates are spec coordinates. Power-on behaves as if every block had just been placed by hand, then runs until nothing changes. A clock never rests: give it a small `settleTicks`.

## Test steps
| Step | Does |
|---|---|
| `{"set": {"A": 1, "B": "x + 1"}}` | drive inputs (between ticks, like a click) |
| `{"press": "BTN"}` | press a button input |
| `{"pulse": {"A": 4}}` | A on now, off 4 gt later |
| `{"wait": 10}` | run 10 game ticks |
| `{"settle": 40}` | run until nothing is scheduled or moving (fails if still busy after 40) |
| `{"expect": {"Q": 1, "S": "A + B"}}` | check now |
| `{"expect": "S == (A + B) % 8 && C == (A + B > 7)"}` | any condition |
| `{"expect": {…}, "within": 10}` | wait up to 10 gt for it, and report the latency |
| `{"expect": {…}, "for": 20}` | must hold now and for the next 20 gt |
| `{"measure": "CLK", "ticks": 200, "expect": {"period": 20, "high": 10}}` | pulses, period, high time |
| `{"log": ["Q", "S"]}` | note values in the report |
| `{"use": [x,y,z]}`, `{"place": {"at": [x,y,z], "block": "…"}}`, `{"break": [x,y,z]}` | raw actions |

**Writing tests**
- `forAll: {"A": [0, 15], "B": {"values": [0, 7, 15]}}` runs the steps once per combination, each case from the rest state.
- More combinations than `samples` (default 256) are sampled at random, extremes included.
- Names in strings are the test's variables and the current I/O values.
- Expressions use `+ - * / % ** & | ^ ~ << >>`, comparisons, `&& || !`, `?:`, `min max abs floor bit(x, i)`.
- Tick counts accept expressions too: `{"wait": "k * 4"}`.
- `trace: ["A", "Q"]` lists every change of those signals with its tick.

**Reading the report.** Failures name the step, the tick, the case and the values.

Problems show as `!` lines:
- **torch burnt out**: 8 turn-offs within 60 gt. Slow the clock down.
- **popped off**: a component lost the block it stood on.
- **left the area**: something was pushed out of the simulated space.
- **update suppressed**: an endless update chain.

## Tools
- `simulate`: run the stored tests, or `tests` written right there. You can add `inputs`/`outputs` to probe something without editing the spec.
- `locations: 8` reruns everything at 8 world positions: dust and pistons update their neighbours in an order that depends on where the build sits. A design that passes at some positions and fails at others is broken in the game too. Avoid relying on update order, e.g. dust-based BUDs or 0-tick tricks.
- `show: "test name"` plays that test live in the user's viewer.
- `edit_build` with `{op:"circuit", set:{tests:[…]}}` adds or replaces tests by name. `{name, remove:true}` deletes one.
- In the viewer the user drives the inputs, runs ▶ at any speed and clicks levers with the hand (U).

## Verified building blocks
All of these pass their tests. Copy them as components and scale them with `place` + `repeat` or a script.

**AND** (two inverted inputs into one dust line, inverted again; 4 gt):
```json
{"name": "AND gate", "minecraftVersion": "1.21.4", "operations": [{"type": "box", "id": "floor", "from": [0, -1, 0], "to": [7, -1, 2], "block": "smooth_stone"}, {"type": "blocks", "id": "inputs", "block": "lever[face=wall,facing=west]", "at": [[0, 0, 0], [0, 0, 2]]}, {"type": "blocks", "id": "input_blocks", "block": "stone", "at": [[1, 0, 0], [1, 0, 2]]}, {"type": "blocks", "id": "not_torches", "block": "redstone_wall_torch[facing=east]", "at": [[2, 0, 0], [2, 0, 2]]}, {"type": "line", "id": "or_line", "from": [3, 0, 0], "to": [3, 0, 2], "block": "redstone_wire"}, {"type": "blocks", "id": "to_out", "block": "redstone_wire", "at": [[4, 0, 1]]}, {"type": "blocks", "id": "out_block", "block": "stone", "at": [[5, 0, 1]]}, {"type": "blocks", "id": "out_torch", "block": "redstone_wall_torch[facing=east]", "at": [[6, 0, 1]]}, {"type": "blocks", "id": "lamp", "block": "redstone_lamp", "at": [[7, 0, 1]]}], "circuit": {"inputs": {"A": {"at": [0, 0, 0]}, "B": {"at": [0, 0, 2]}}, "outputs": {"Q": {"at": [7, 0, 1]}}, "tests": [{"name": "truth table", "forAll": {"A": [0, 1], "B": [0, 1]}, "steps": [{"set": {"A": "A", "B": "B"}}, {"settle": 40}, {"expect": {"Q": "A && B"}}]}, {"name": "delay", "steps": [{"set": {"A": 1, "B": 1}}, {"expect": {"Q": 1}, "within": 10}]}]}}
```
NOT = one block plus a wall torch. OR = dust lines that join. NOR = OR into a block plus a torch.

**D latch** (a repeater locked by a powered repeater pointing into its side holds its output):
```json
{"name": "D latch", "minecraftVersion": "1.21.4", "operations": [{"type": "box", "id": "floor", "from": [0, -1, 0], "to": [4, -1, 3], "block": "smooth_stone"}, {"type": "blocks", "id": "data", "block": "lever[face=floor,facing=east]", "at": [[0, 0, 1]]}, {"type": "blocks", "id": "data_dust", "block": "redstone_wire", "at": [[1, 0, 1]]}, {"type": "blocks", "id": "memory", "block": "repeater[facing=west]", "at": [[2, 0, 1]]}, {"type": "blocks", "id": "out", "block": "redstone_lamp", "at": [[3, 0, 1]]}, {"type": "blocks", "id": "hold", "block": "lever[face=floor,facing=north]", "at": [[2, 0, 3]]}, {"type": "blocks", "id": "lock", "block": "repeater[facing=south]", "at": [[2, 0, 2]]}], "circuit": {"inputs": {"D": {"at": [0, 0, 1]}, "HOLD": {"at": [2, 0, 3]}}, "outputs": {"Q": {"at": [3, 0, 1]}}, "tests": [{"name": "follows D while not held", "forAll": {"D": [0, 1]}, "steps": [{"set": {"D": "D"}}, {"expect": {"Q": "D"}, "within": 6}]}, {"name": "remembers while held", "forAll": {"D": [0, 1]}, "steps": [{"set": {"D": "D"}}, {"settle": 20}, {"set": {"HOLD": 1}}, {"wait": 4}, {"set": {"D": "1 - D"}}, {"expect": {"Q": "D"}, "for": 20}]}]}}
```

**Clock** (torch + repeater loop, 20 gt period; a lever on the torch's block stops it):
```json
{"name": "Clock", "minecraftVersion": "1.21.4", "operations": [{"type": "box", "id": "floor", "from": [0, -1, 0], "to": [3, -1, 3], "block": "smooth_stone"}, {"type": "blocks", "id": "core", "block": "stone", "at": [[0, 0, 0]]}, {"type": "blocks", "id": "torch", "block": "redstone_wall_torch[facing=east]", "at": [[1, 0, 0]]}, {"type": "line", "id": "loop", "points": [[2, 0, 0], [2, 0, 2], [0, 0, 2]], "block": "redstone_wire"}, {"type": "blocks", "id": "delay", "block": "repeater[facing=south,delay=4]", "at": [[0, 0, 1]]}, {"type": "blocks", "id": "stop", "block": "lever[face=wall,facing=north,powered=true]", "at": [[0, 0, -1]]}], "circuit": {"inputs": {"STOP": {"at": [0, 0, -1]}}, "outputs": {"TICK": {"at": [2, 0, 1]}}, "tests": [{"name": "stopped", "steps": [{"expect": {"TICK": 0}, "for": 40}]}, {"name": "runs with a 20-tick period", "steps": [{"set": {"STOP": 0}}, {"wait": 20}, {"measure": "TICK", "ticks": 200, "expect": {"period": 20, "high": 10}}]}]}}
```
With a delay-1 repeater the period would be 8 gt, and the torch burns out (8 turn-offs within 60 gt). Keep torch clocks at 16 gt or slower, or use observers or comparators.

**Pulse on every change** (an observer watching the input):
```json
{"name": "Pulse", "minecraftVersion": "1.21.4", "operations": [{"type": "box", "id": "floor", "from": [0, -1, 0], "to": [3, -1, 0], "block": "smooth_stone"}, {"type": "blocks", "id": "lever", "block": "lever[face=floor,facing=east]", "at": [[0, 0, 0]]}, {"type": "blocks", "id": "observer", "block": "observer[facing=west]", "at": [[1, 0, 0]]}, {"type": "line", "id": "out", "from": [2, 0, 0], "to": [3, 0, 0], "block": "redstone_wire"}], "circuit": {"inputs": {"IN": {"at": [0, 0, 0]}}, "outputs": {"OUT": {"at": [3, 0, 0]}}, "tests": [{"name": "a 2-tick pulse on every change", "steps": [{"set": {"IN": 1}}, {"expect": {"OUT": 1}, "within": 2}, {"expect": {"OUT": 1}, "for": 1}, {"expect": {"OUT": 0}, "within": 2}, {"settle": 10}, {"set": {"IN": 0}}, {"measure": "OUT", "ticks": 10, "expect": {"pulses": 1, "high": 2}}]}]}}
```

**2×1 piston door** (lever under a block powers both sticky pistons; outputs read whether the doorway is blocked):
```json
{"name": "Piston door", "minecraftVersion": "1.21.4", "operations": [{"type": "box", "id": "floor", "from": [-2, -1, -1], "to": [4, -1, 3], "block": "smooth_stone"}, {"type": "box", "id": "wall", "from": [-2, 0, 1], "to": [4, 2, 1], "block": "stone_bricks"}, {"type": "box", "id": "doorway", "from": [1, 0, 1], "to": [1, 1, 1], "block": "air"}, {"type": "blocks", "id": "pistons", "block": "sticky_piston[facing=east]", "at": [[-1, 0, 1], [-1, 1, 1]]}, {"type": "blocks", "id": "panels", "block": "stone_bricks", "at": [[0, 0, 1], [0, 1, 1]]}, {"type": "blocks", "id": "switch", "block": "lever[face=ceiling,facing=north]", "at": [[-1, 0, 2]]}, {"type": "box", "id": "fill", "from": [-2, 0, 1], "to": [-2, 1, 1], "block": "stone_bricks"}, {"type": "blocks", "id": "switch_block", "block": "stone_bricks", "at": [[-1, 1, 2]]}], "circuit": {"inputs": {"CLOSE": {"at": [-1, 0, 2]}}, "outputs": {"SHUT": {"at": [[1, 0, 1], [1, 1, 1]], "read": "block"}}, "tests": [{"name": "opens and closes", "steps": [{"expect": {"SHUT": 0}}, {"set": {"CLOSE": 1}}, {"settle": 10}, {"expect": "SHUT == 3"}, {"set": {"CLOSE": 0}}, {"settle": 10}, {"expect": {"SHUT": 0}}]}]}}
```

**Generated** (a script lays out N stages; the test checks the timing of every stage):
```json
{"name": "Light chaser", "minecraftVersion": "1.21.4", "operations": [{"type": "script", "id": "chaser", "args": {"stages": 8, "delay": 2}, "code": "const n = args.stages;\nbox([-1, -1, -1], [2 * n + 1, -1, 1], 'smooth_stone');\nset(0, 0, 0, 'lever[face=floor,facing=east]');\nfor (let k = 0; k < n; k++) {\n  set(1 + 2 * k, 0, 0, `repeater[facing=west,delay=${args.delay}]`);\n  set(2 + 2 * k, 0, 0, 'redstone_lamp');\n}"}], "circuit": {"inputs": {"GO": {"at": [0, 0, 0]}}, "outputs": {"LAMPS": {"at": [[2, 0, 0], [4, 0, 0], [6, 0, 0], [8, 0, 0], [10, 0, 0], [12, 0, 0], [14, 0, 0], [16, 0, 0]]}}, "tests": [{"name": "one more lamp every 4 ticks", "forAll": {"k": [1, 8]}, "steps": [{"set": {"GO": 1}}, {"wait": "k * 4"}, {"expect": {"LAMPS": "2 ** k - 1"}}]}, {"name": "all on, then all off", "steps": [{"set": {"GO": 1}}, {"expect": {"LAMPS": 255}, "within": 32}, {"set": {"GO": 0}}, {"expect": {"LAMPS": 0}, "within": 40}]}]}}
```

## Building big
1. **Specify first.**
   - Name every input and output.
   - Write a test for each behaviour: truth tables with `forAll`, timing with `within`, clocks with `measure`, memory with `for`.
   - For wide arithmetic, sample (`samples`) and always include the edge cases.
2. **Design in modules.**
   - One BuildSpec `component` per gate or cell, tested alone first: a spec with only that module and its own `circuit`.
   - Then `place` it with `repeat` (bit slices) or from a `script` (decoders, ROMs, adders), and make buses with lists of positions.
3. **Route in layers.**
   - Give each signal direction its own y level.
   - Cross with repeaters, which are insulated sideways, or by going over on blocks.
   - Rise with torch towers (+2 gt per stage), or observer or scaffold lines.
   - Restore strength with a repeater every ≤15 dust, and before every comparator that compares two signals: a comparator in subtract mode needs both at full strength.
4. **Keep timing explicit.**
   - Every repeater adds delay, and parallel paths must arrive together, or the outputs glitch.
   - Match delays with repeater settings. Check them with `expect … within` and `trace`.
   - In tests, read results after `settle`, not after a guessed `wait`.
5. **Iterate fast.**
   - `simulate` with ad-hoc tests and probes (`outputs: {"X": {"at": […], "read": "power"}}`) shows the inside of the circuit.
   - `inspect` shows the exact blocks.
   - Fix by operation id with `edit_build`; the tests run again on every edit.
6. **Before handing over**, run `simulate` with `locations: 8`, and `show` one test to the user.

Signals: a comparator's subtract mode with full-strength inputs gives `A AND NOT B`. Two of them sharing one side input X compute `A AND NOT X` and `B AND NOT X`. With X = A AND B, joining their outputs gives A XOR B. Comparators accept side inputs from dust, repeaters, comparators, observers and redstone blocks, never from torches.

## Versions
| Release | What changes |
|---|---|
| 1.8–1.12 | Dust depowers one level per update. A lone dust powers all four sides. Lit/unlit torches, lamps and diodes are separate blocks: only the lit or powered one updates its surroundings, and a powered repeater turning off updates all around it. Note blocks can't be pushed. No observers before 1.11. Before 1.9.1 a tick runs at most 1000 scheduled ticks. |
| 1.13 | Block states are flattened, and torches and diodes check whether a tick is already running. Components pop off on shape updates. |
| 1.14 | Dust stays on glass, ice and sea lanterns. |
| 1.15 | Honey block: it sticks like slime but never to slime. |
| 1.16 | Dust "+" and "•" shapes: dust powers only the sides it visibly connects to. Target block. |
| 1.17 | Lightning rod, sculk sensor (signal strength only; vibrations aren't simulated). |
| 1.19 | Neighbour updates are queued depth-first instead of nested. A few piston and observer contraptions behave differently from 1.18. |
| 1.21 | Copper bulb (toggles at once on each rising edge, non-conductive), crafter (4 gt). |
| 1.21.2+ | The opt-in "Redstone Experiments" are **not** simulated: vanilla behaviour only. |

## What isn't simulated
- Entities: items, mobs, minecarts. Pressure plates are driven as inputs.
- Hoppers moving items: comparators read containers as filled in the spec, through `nbt` Items.
- Explosions: primed TNT is reported. Water and lava flow aren't simulated, and daylight and vibrations come in through inputs.
- The space below the build is solid ground. Slime or honey resting on it sticks to it, as it would on a real floor. Blocks pushed further than 6 blocks outside the build leave the simulation.
