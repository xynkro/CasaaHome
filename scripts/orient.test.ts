import type { Pt, Wall } from '../src/types'
import { nearestWall, suggestPlacement } from '../src/lib/orient'

let fails = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}`, cond ? '' : JSON.stringify(extra))
  if (!cond) fails++
}

let seq = 0
const wall = (ax: number, az: number, bx: number, bz: number, thickness = 0.1): Wall =>
  ({ id: `w${seq++}`, a: { x: ax, z: az }, b: { x: bx, z: bz }, height: 2.7, thickness })

/** The four walls of an axis-aligned rectangle, in N, E, S, W order. */
const box = (x0: number, z0: number, x1: number, z1: number, t = 0.1): Wall[] => [
  wall(x0, z0, x1, z0, t), wall(x1, z0, x1, z1, t),
  wall(x1, z1, x0, z1, t), wall(x0, z1, x0, z0, t),
]

const at = (x: number, z: number): Pt => ({ x, z })
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

/** Where the box's back points, from the convention that 0 faces its back at -z. */
const backOf = (deg: number): Pt => {
  const r = (deg * Math.PI) / 180
  return { x: -Math.sin(r), z: -Math.cos(r) }
}

/** 1 when the back points straight at the wall, -1 when it faces away. */
const backsOnto = (deg: number, from: Pt, to: Pt): number => {
  const b = backOf(deg)
  const len = Math.hypot(to.x - from.x, to.z - from.z)
  if (len < 1e-12) return 1
  return b.x * ((to.x - from.x) / len) + b.z * ((to.z - from.z) / len)
}

// --- the four cardinal walls ----------------------------------------------
// Read from inside a 6x6 room: against the north wall you face south, and so on.
{
  const room = box(0, 0, 6, 6)
  const cases: [string, Pt, number][] = [
    ['north wall (z=0), box south of it', at(3, 0.4), 0],
    ['west wall (x=0), box east of it', at(0.4, 3), 90],
    ['south wall (z=6), box north of it', at(3, 5.6), 180],
    ['east wall (x=6), box west of it', at(5.6, 3), 270],
  ]
  for (const [name, p, deg] of cases) {
    const hit = nearestWall(p, room)
    check(`${name} gives ${deg}deg`, !!hit && near(hit.angleDeg, deg), hit?.angleDeg)
    check(`${name}: back is flat on the wall`,
      !!hit && near(backsOnto(hit.angleDeg, p, hit.closest), 1), hit)
    check(`${name}: measured to the near face`, !!hit && near(hit.distance, 0.4), hit?.distance)
  }
}

// --- a wall on the diagonal -------------------------------------------------
{
  const diag = [wall(0, 0, 4, 4)]
  const below = nearestWall(at(2.5, 1.5), diag)
  const above = nearestWall(at(1.5, 2.5), diag)
  check('45deg wall, point to its south-east', !!below && near(below.angleDeg, 135), below?.angleDeg)
  check('45deg wall, point to its north-west', !!above && near(above.angleDeg, 315), above?.angleDeg)
  check('45deg back sits flat, not skewed',
    !!below && near(backsOnto(below.angleDeg, at(2.5, 1.5), below.closest), 1), below)
  check('45deg foot is the perpendicular one',
    !!below && near(below.closest.x, 2) && near(below.closest.z, 2), below?.closest)
  check('45deg distance is the perpendicular one',
    !!below && near(below.distance, Math.SQRT1_2), below?.distance)
}

// --- either side of the same wall ------------------------------------------
{
  const one = [wall(0, 0, 6, 0)]
  const south = nearestWall(at(2, 0.5), one)
  const north = nearestWall(at(2, -0.5), one)
  check('both sides find the same wall', south?.wall.id === north?.wall.id, [south?.wall.id, north?.wall.id])
  check('opposite sides are 180deg apart',
    !!south && !!north && near(Math.abs(south.angleDeg - north.angleDeg), 180),
    [south?.angleDeg, north?.angleDeg])
  check('both are inside [0, 360)',
    !!south && !!north && south.angleDeg >= 0 && south.angleDeg < 360
      && north.angleDeg >= 0 && north.angleDeg < 360,
    [south?.angleDeg, north?.angleDeg])
}

// A wall traced the other way round must not flip the answer: the side the
// point is on is a fact about the world, not about drawing order.
{
  const forward = nearestWall(at(2, 0.5), [wall(0, 0, 6, 0)])
  const reversed = nearestWall(at(2, 0.5), [wall(6, 0, 0, 0)])
  check('wall drawn backwards gives the same rotation',
    !!forward && !!reversed && near(forward.angleDeg, reversed.angleDeg),
    [forward?.angleDeg, reversed?.angleDeg])
}

// --- the flush offset -------------------------------------------------------
{
  const w = wall(0, 0, 6, 0, 0.2)
  const depth = 0.5
  const want = 0.2 / 2 + depth / 2

  // Starts INSIDE the wall, so the nudge has to push it out, not just leave it.
  const out = suggestPlacement(at(2, 0.05), [w], depth)
  check('overlapping box is pushed clear', out.snapped && near(out.position.z, want), out)
  check('and not slid along the wall', near(out.position.x, 2), out.position)

  const other = suggestPlacement(at(2, -0.05), [w], depth)
  check('the far side is pushed the other way', other.snapped && near(other.position.z, -want), other)

  // Starts too far out, so the same rule has to pull it back in.
  const back = suggestPlacement(at(2, 0.9), [w], depth)
  check('a box floating off the wall is pulled flush', back.snapped && near(back.position.z, want), back)

  // Diagonal: measure the offset along the normal rather than in z.
  const d = wall(0, 0, 4, 4, 0.3)
  const dp = at(2.5, 1.5)
  const got = suggestPlacement(dp, [d], 0.6)
  const n = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }
  const offset = got.position.x * n.x + got.position.z * n.z
  check('diagonal offset is thickness/2 + depth/2', got.snapped && near(offset, 0.15 + 0.3), offset)
  check('diagonal nudge is purely perpendicular',
    near((got.position.x - dp.x) * Math.SQRT1_2 + (got.position.z - dp.z) * Math.SQRT1_2, 0),
    got.position)
  check('diagonal placement keeps the rotation', near(got.rotationDeg, 135), got.rotationDeg)
}

// --- nothing near enough ----------------------------------------------------
{
  const island = at(3, 3)
  const room = box(0, 0, 6, 6)
  check('a point in the middle of the room snaps to nothing', nearestWall(island, room) === null)
  const p = suggestPlacement(island, room, 0.6)
  check('and is left exactly where it was',
    !p.snapped && p.position.x === 3 && p.position.z === 3 && p.rotationDeg === 0, p)

  // The default reach, exactly.
  check('1.2 m away still counts', nearestWall(at(3, 1.2), [wall(0, 0, 6, 0)]) !== null)
  check('1.21 m away does not', nearestWall(at(3, 1.21), [wall(0, 0, 6, 0)]) === null)
  check('a wider reach is honoured', nearestWall(island, room, 4) !== null)
  check('a zero reach snaps only on the line',
    nearestWall(at(3, 0), [wall(0, 0, 6, 0)], 0) !== null
    && nearestWall(at(3, 0.01), [wall(0, 0, 6, 0)], 0) === null)
  check('opts.maxDistance reaches the placement too',
    suggestPlacement(island, room, 0.6, { maxDistance: 4 }).snapped)
  for (const bad of [NaN, Infinity, -Infinity, -1]) {
    const hit = nearestWall(at(3, 0.4), room, bad)
    check(`maxDistance ${String(bad)} falls back to the default`, !!hit && near(hit.angleDeg, 0), hit)
  }
}

// --- competing walls --------------------------------------------------------
{
  const room = box(0, 0, 6, 6)
  const corner = nearestWall(at(0.4, 0.5), room)
  check('the nearer of two walls in a corner wins', !!corner && near(corner.angleDeg, 90), corner?.angleDeg)
  check('and reports its own distance', !!corner && near(corner.distance, 0.4), corner?.distance)

  const other = nearestWall(at(0.5, 0.4), room)
  check('lean the other way and the other wall wins', !!other && near(other.angleDeg, 0), other?.angleDeg)

  // A partition closer than the exterior wall behind it.
  const withPartition = [...room, wall(0, 2, 6, 2)]
  const inner = nearestWall(at(3, 1.7), withPartition)
  check('a partition beats the wall behind it',
    !!inner && near(inner.closest.z, 2) && near(inner.angleDeg, 180), inner)

  // Equidistant: the earlier wall in the list wins, and keeps winning.
  const tie = [wall(0, 0, 6, 0), wall(0, 1, 6, 1)]
  const a = nearestWall(at(3, 0.5), tie)
  const b = nearestWall(at(3, 0.5), tie)
  check('an exact tie is resolved the same way twice',
    a?.wall.id === tie[0].id && b?.wall.id === tie[0].id, [a?.wall.id, b?.wall.id])
}

// --- past the end of a wall -------------------------------------------------
{
  // 2 m beyond the end and 0.5 m to the side. Measuring off the infinite line
  // would call that 0.5 m and snap a wardrobe to a wall in the next room.
  const stub = [wall(0, 0, 4, 0)]
  const p = at(6, 0.5)
  check('beyond the end, the infinite line does not reach', nearestWall(p, stub) === null)

  const hit = nearestWall(p, stub, 3)
  check('beyond the end, distance is to the corner',
    !!hit && near(hit.distance, Math.hypot(2, 0.5)), hit?.distance)
  check('and the foot IS the corner', !!hit && near(hit.closest.x, 4) && near(hit.closest.z, 0), hit?.closest)
  check('but the rotation still lies along the wall', !!hit && near(hit.angleDeg, 0), hit?.angleDeg)

  const before = nearestWall(at(-1, -0.5), stub, 3)
  check('past the other end clamps to the other corner',
    !!before && near(before.closest.x, 0) && near(before.closest.z, 0), before?.closest)
  check('and takes the side the point is on', !!before && near(before.angleDeg, 180), before?.angleDeg)
}

// --- on the wall itself ------------------------------------------------------
{
  const one = [wall(0, 0, 6, 0)]
  const on = nearestWall(at(3, 0), one)
  const again = nearestWall(at(3, 0), one)
  check('a point on the centreline still snaps', !!on && near(on.distance, 0), on?.distance)
  check('and picks a side deterministically', on?.angleDeg === again?.angleDeg, [on?.angleDeg, again?.angleDeg])
  check('the side it picks is one of the two valid ones',
    !!on && (near(on.angleDeg, 0) || near(on.angleDeg, 180)), on?.angleDeg)

  const placed = suggestPlacement(at(3, 0), one, 0.5)
  check('and is pushed a full clearance off the line',
    placed.snapped && near(Math.abs(placed.position.z), 0.05 + 0.25), placed)
}

// --- degenerate input ---------------------------------------------------------
{
  check('no walls at all', nearestWall(at(1, 1), []) === null)
  const nowhere = suggestPlacement(at(1, 1), [], 0.6)
  check('placement with no walls is a no-op',
    !nowhere.snapped && nowhere.position.x === 1 && nowhere.position.z === 1 && nowhere.rotationDeg === 0,
    nowhere)

  check('a zero-length wall orients nothing', nearestWall(at(1, 1), [wall(2, 2, 2, 2)]) === null)
  check('a zero-length wall is skipped, not fatal',
    nearestWall(at(3, 0.4), [wall(2, 2, 2, 2), wall(0, 0, 6, 0)]) !== null)

  const holey = [null, undefined, wall(0, 0, 6, 0)] as unknown as Wall[]
  check('holes in the wall list are stepped over', nearestWall(at(3, 0.4), holey) !== null)
  const noEnds = [{ id: 'x', a: null, b: null, height: 2.7, thickness: 0.1 }] as unknown as Wall[]
  check('a wall with no endpoints is skipped', nearestWall(at(3, 0.4), noEnds) === null)
  check('a wall with NaN endpoints is skipped',
    nearestWall(at(3, 0.4), [wall(NaN, 0, 6, 0)]) === null)
  check('a non-array wall list is tolerated',
    nearestWall(at(1, 1), null as unknown as Wall[]) === null)

  // A wall with overflowing coordinates measures NaN, and NaN loses every
  // comparison — listed first it used to lock out every wall behind it.
  const huge = wall(1e308, 0, 1e308, 4)
  const poisoned = nearestWall(at(3, 0.4), [huge, wall(0, 0, 6, 0)])
  check('an overflowing wall does not shadow the real one',
    !!poisoned && near(poisoned.angleDeg, 0) && near(poisoned.distance, 0.4), poisoned)
  check('and on its own it snaps to nothing', nearestWall(at(3, 0.4), [huge]) === null)
  check('an infinitely long wall is not a wall',
    nearestWall(at(3, 0.4), [wall(-1e308, 0, 1e308, 0)]) === null)
}

// --- non-finite input ----------------------------------------------------------
{
  const room = box(0, 0, 6, 6)
  for (const bad of [NaN, Infinity, -Infinity]) {
    check(`a point at x=${String(bad)} snaps to nothing`, nearestWall(at(bad, 3), room) === null)
    const p = suggestPlacement(at(bad, 3), room, 0.6)
    check(`x=${String(bad)} comes back unchanged and unsnapped`,
      !p.snapped && p.rotationDeg === 0 && Object.is(p.position.x, bad) && p.position.z === 3, p)
  }
  const missing = suggestPlacement(undefined as unknown as Pt, room, 0.6)
  check('a missing point does not throw',
    !missing.snapped && Number.isNaN(missing.position.x), missing)

  // Junk dimensions must not poison the coordinates; they count as zero.
  const w = wall(0, 0, 6, 0, 0.2)
  for (const bad of [NaN, -1, Infinity]) {
    const p = suggestPlacement(at(2, 0.5), [w], bad)
    check(`depth ${String(bad)} falls back to nothing but the wall face`,
      p.snapped && near(p.position.z, 0.1), p.position)
  }
  const noThickness = { ...wall(0, 0, 6, 0), thickness: NaN } as Wall
  const p = suggestPlacement(at(2, 0.5), [noThickness], 0.5)
  check('a wall with no thickness still places the box',
    p.snapped && near(p.position.z, 0.25), p.position)
}

// --- rotations stay in range ----------------------------------------------------
// Sweep a box round a fixed wall: every answer must be normalised, and the back
// must face the wall from wherever it is asked.
{
  const w = [wall(-4, 0, 4, 0)]
  let worst = 0
  let ranged = true
  for (let deg = 0; deg < 360; deg += 7) {
    const r = (deg * Math.PI) / 180
    const p = at(Math.cos(r) * 0.8, Math.sin(r) * 0.8)
    const hit = nearestWall(p, w)
    if (!hit) { ranged = false; break }
    if (hit.angleDeg < 0 || hit.angleDeg >= 360) ranged = false
    const facing = 1 - backsOnto(hit.angleDeg, p, hit.closest)
    if (facing > worst) worst = facing
  }
  check('every sampled rotation is in [0, 360)', ranged)
  check('and every one of them backs onto the wall', near(worst, 0, 1e-9), worst)
}

console.log(fails === 0 ? '\nAll orientation checks passed.' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
