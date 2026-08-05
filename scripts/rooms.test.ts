import type { Pt, Wall } from '../src/types'
import { roomsFromWalls, polygonArea } from '../src/lib/rooms'

let fails = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}`, cond ? '' : JSON.stringify(extra))
  if (!cond) fails++
}

let seq = 0
const wall = (ax: number, az: number, bx: number, bz: number): Wall =>
  ({ id: `w${seq++}`, a: { x: ax, z: az }, b: { x: bx, z: bz }, height: 2.7, thickness: 0.1 })

/** The four walls of an axis-aligned rectangle. */
const box = (x0: number, z0: number, x1: number, z1: number): Wall[] => [
  wall(x0, z0, x1, z0), wall(x1, z0, x1, z1), wall(x1, z1, x0, z1), wall(x0, z1, x0, z0),
]

const areas = (walls: Wall[], tol?: number) =>
  roomsFromWalls(walls, tol === undefined ? undefined : { tolerance: tol })
    .map(p => Math.abs(polygonArea(p)))
    .sort((a, b) => a - b)

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

// --- one room -------------------------------------------------------------
const square = roomsFromWalls(box(0, 0, 4, 4))
check('single square is one room', square.length === 1, square.length)
check('single square has the right area', near(polygonArea(square[0]), 16), square[0])
check('single square is a quadrilateral', square[0].length === 4, square[0])
check('winding is counter-clockwise in x/z', polygonArea(square[0]) > 0, polygonArea(square[0]))

// --- two rooms sharing a wall ---------------------------------------------
const pair = areas([...box(0, 0, 4, 4), ...box(4, 0, 8, 4)])
check('shared wall gives two rooms', pair.length === 2, pair)
check('both halves measured right', near(pair[0], 16) && near(pair[1], 16), pair)

// --- L-shaped outline ------------------------------------------------------
const ell = roomsFromWalls([
  wall(0, 0, 6, 0), wall(6, 0, 6, 3), wall(6, 3, 3, 3),
  wall(3, 3, 3, 6), wall(3, 6, 0, 6), wall(0, 6, 0, 0),
])
check('L-shape is one room', ell.length === 1, ell.length)
check('L-shape area is bbox minus the notch', near(polygonArea(ell[0]), 27), polygonArea(ell[0]))
check('L-shape keeps all six corners', ell[0].length === 6, ell[0])

// --- T-junction: a partition landing mid-span ------------------------------
// Neither end of the partition touches a traced corner, so both ends must
// split the wall they land on or nothing ever closes.
const tee = areas([...box(0, 0, 8, 4), wall(4, 0, 4, 4)])
check('T-junction splits the room in two', tee.length === 2, tee)
check('T-junction halves are equal', near(tee[0], 16) && near(tee[1], 16), tee)

// One-sided T: the partition stops short of the far wall, enclosing nothing new.
const openTee = areas([...box(0, 0, 8, 4), wall(4, 0, 4, 2.5)])
check('a partition that stops short leaves one room', openTee.length === 1, openTee)
check('and that room is the whole floor', near(openTee[0], 32), openTee)

// --- X crossing ------------------------------------------------------------
const cross = areas([...box(0, 0, 8, 8), wall(0, 4, 8, 4), wall(4, 0, 4, 8)])
check('mid-span crossing gives four rooms', cross.length === 4, cross)
check('all four quarters measured right', cross.every(a => near(a, 16)), cross)

// --- degenerate input ------------------------------------------------------
check('no walls at all', roomsFromWalls([]).length === 0)
const open = areas([wall(0, 0, 4, 0), wall(4, 0, 4, 4), wall(4, 4, 0, 4)])
check('an unclosed outline encloses nothing', open.length === 0, open)

const zeroLen = roomsFromWalls([...box(0, 0, 4, 4), wall(2, 2, 2, 2)])
check('zero-length wall is ignored', zeroLen.length === 1, zeroLen.length)

const dangler = roomsFromWalls([...box(0, 0, 4, 4), wall(0, 0, 2, 2)])
check('a dangling wall inside still leaves one room', dangler.length === 1, dangler.length)
check('the spur is retracted out of the polygon',
  dangler.length === 1 && dangler[0].length === 4 && near(polygonArea(dangler[0]), 16), dangler[0])

const stranded = roomsFromWalls([...box(0, 0, 4, 4), wall(1, 1, 3, 1), wall(3, 1, 3, 3)])
check('floating walls that enclose nothing are dropped', stranded.length === 1, stranded.length)

// --- duplicates and near-duplicates ---------------------------------------
const dupes = areas([...box(0, 0, 4, 4), wall(0, 0, 4, 0), wall(4, 4, 0, 4)])
check('exact duplicate walls make no extra room', dupes.length === 1, dupes)
check('duplicated room still measures right', near(dupes[0], 16), dupes)

// Re-traced 2 cm off: welds onto the same corners rather than shaving a sliver.
const retraced = areas([...box(0, 0, 4, 4), wall(0, 0.02, 4, 0.02)])
check('a near-duplicate trace makes no sliver', retraced.length === 1, retraced)
check('near-duplicate room keeps its area', near(retraced[0], 16, 0.2), retraced)

// Too far apart to weld, so it really is its own edge — but the 0.4 m^2 strip
// it leaves behind is under the sliver threshold and gets dropped.
const sliver = areas([...box(0, 0, 4, 4), wall(0, 0.1, 4, 0.1)])
check('a thin gap is not a room', sliver.length === 1, sliver)
check('the surviving room is the big one', near(sliver[0], 15.6, 0.05), sliver)

// --- collinear tidying -----------------------------------------------------
const inTwo = roomsFromWalls([
  wall(0, 0, 2, 0), wall(2, 0, 4, 0), wall(4, 0, 4, 4), wall(4, 4, 0, 4), wall(0, 4, 0, 0),
])
check('a wall drawn in two pieces is one room', inTwo.length === 1, inTwo.length)
check('collinear midpoints are removed', inTwo.length === 1 && inTwo[0].length === 4, inTwo[0])
check('splitting did not change the area', near(polygonArea(inTwo[0]), 16), inTwo[0])

// The T-junction split point is collinear on the wall it landed on.
const teePoly = roomsFromWalls([...box(0, 0, 8, 4), wall(4, 0, 4, 4)])
check('T-junction rooms come back as rectangles',
  teePoly.length === 2 && teePoly.every(p => p.length === 4), teePoly.map(p => p.length))

// --- a real plan: three rooms in a row -------------------------------------
// Traced by hand, so the corners miss by a centimetre or two and the partitions
// meet the long walls mid-span.
const row = areas([
  wall(0, 0, 9.01, 0.01), wall(9, 0, 9, 3), wall(9.01, 3, -0.01, 3.01), wall(0, 3, 0, 0),
  wall(3, 0.02, 3, 3), wall(6, 0, 5.99, 2.98),
])
check('three rooms in a row', row.length === 3, row)
check('each is its own third of the floor', row.every(a => near(a, 9, 0.15)), row)

const rowPolys = roomsFromWalls([
  wall(0, 0, 9.01, 0.01), wall(9, 0, 9, 3), wall(9.01, 3, -0.01, 3.01), wall(0, 3, 0, 0),
  wall(3, 0.02, 3, 3), wall(6, 0, 5.99, 2.98),
])
check('all three are counter-clockwise', rowPolys.every(p => polygonArea(p) > 0),
  rowPolys.map(p => polygonArea(p)))
check('none of them came back with stray vertices',
  rowPolys.every(p => p.length === 4), rowPolys.map(p => p.length))

// --- tolerance is honoured -------------------------------------------------
// A 30 cm gap at one corner: too wide for the default weld, fine for a wide one.
const gappy = [wall(0, 0, 4, 0), wall(4, 0, 4, 4), wall(4, 4, 0, 4), wall(0, 4, 0, 0.3)]
check('a wide gap does not close by default', areas(gappy).length === 0, areas(gappy))
check('a bigger tolerance closes it', areas(gappy, 0.4).length === 1, areas(gappy, 0.4))


// --- regressions found by adversarial probing ------------------------------

// Simplification used to measure each vertex against its already-simplified
// neighbours, so error compounded and a finely traced curve lost its area.
{
  const N = 240, R = 5
  const ring: Pt[] = Array.from({ length: N }, (_, i) => ({
    x: R * Math.cos((i / N) * Math.PI * 2),
    z: R * Math.sin((i / N) * Math.PI * 2),
  }))
  const curved = ring.map((p, i) => wall(p.x, p.z, ring[(i + 1) % N].x, ring[(i + 1) % N].z))
  const got = roomsFromWalls(curved)
  const area = got.length ? Math.abs(polygonArea(got[0])) : 0
  const trueArea = Math.PI * R * R
  check('a traced curve keeps its area', got.length === 1 && Math.abs(area - trueArea) / trueArea < 0.03,
    { faces: got.length, area: area.toFixed(2), trueArea: trueArea.toFixed(2) })
}

// A non-finite tolerance sailed through Math.max and returned half a room.
for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
  const got = roomsFromWalls(box(0, 0, 4, 4), { tolerance: bad as number })
  check(`tolerance ${String(bad)} falls back to the default`,
    got.length === 1 && Math.abs(Math.abs(polygonArea(got[0])) - 16) < 1e-6,
    { faces: got.length, area: got.length ? polygonArea(got[0]) : null })
}

// Shoelace about the origin lost precision on plans far from (0,0).
for (const d of [1e5, 1e6, 1e7]) {
  const got = roomsFromWalls(box(d, d, d + 5, d + 5))
  const area = got.length ? Math.abs(polygonArea(got[0])) : 0
  check(`a 5x5 room at ${d.toExponential(0)} still measures 25`,
    got.length === 1 && Math.abs(area - 25) < 0.01, { faces: got.length, area })
}

console.log(fails === 0 ? '\nAll room checks passed.' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
