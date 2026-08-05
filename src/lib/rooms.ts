import type { Pt, Wall } from '../types'

/**
 * Automatic room detection: turn a loose wall network into the polygons of the
 * regions it encloses (planar face extraction).
 *
 * The input is drawn by hand over a floorplan photo, so it is never a clean
 * graph: corners miss each other by a few centimetres, partitions stop halfway
 * along an exterior wall instead of at a vertex, and the same wall gets traced
 * twice. Weld → split → walk is the order that survives all three.
 */

/** Two endpoints closer than this are the same corner, not two corners. */
const DEFAULT_TOLERANCE = 0.05

/**
 * Anything smaller than this is a sliver between two near-parallel traces of
 * the same wall, not a room. A real cupboard is bigger than half a square metre.
 */
const MIN_AREA = 0.5

export function roomsFromWalls(walls: Wall[], opts?: { tolerance?: number }): Pt[][] {
  if (!Array.isArray(walls) || walls.length === 0) return []
  // Math.max(NaN, x) is NaN, so a non-finite tolerance used to sail through
  // and silently return half a room. Validate rather than clamp one-sidedly.
  const asked = opts?.tolerance
  const tol = Number.isFinite(asked) && (asked as number) > 0
    ? Math.min(Math.max(asked as number, 1e-6), 2)
    : DEFAULT_TOLERANCE

  const nodes = weldEndpoints(walls, tol)
  if (nodes.segs.length === 0) return []

  addCrossings(nodes)
  const edges = splitSegments(nodes, tol)
  if (edges.length === 0) return []

  return facesOf(nodes.pts, edges, tol)
}

/** Signed area in plan metres. Positive means counter-clockwise in x/z. */
export function polygonArea(poly: Pt[]): number {
  if (poly.length < 3) return 0
  // Shoelace about the centroid, not the origin. The absolute-coordinate form
  // subtracts two nearly equal large products and loses most of its significant
  // digits once the polygon sits far from (0,0).
  let cx = 0, cz = 0
  for (const p of poly) { cx += p.x; cz += p.z }
  cx /= poly.length; cz /= poly.length
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += (a.x - cx) * (b.z - cz) - (b.x - cx) * (a.z - cz)
  }
  return sum / 2
}

interface Seg { a: number; b: number }

interface Welded {
  pts: Pt[]
  segs: Seg[]
  add: (p: Pt) => number
}

const usable = (p: Pt | undefined) =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.z)

/**
 * Snap endpoints that land within tolerance of each other onto one shared node.
 * A traced plan never has exactly-coincident coordinates, and without this the
 * graph is a pile of disconnected sticks.
 *
 * Buckets are one tolerance wide so a lookup only has to scan the nine cells
 * around the query point rather than every node placed so far.
 */
function weldEndpoints(walls: Wall[], tol: number): Welded {
  const pts: Pt[] = []
  const cells = new Map<string, number[]>()

  const add = (p: Pt): number => {
    const cx = Math.floor(p.x / tol)
    const cz = Math.floor(p.z / tol)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = cells.get(`${cx + dx}:${cz + dz}`)
        if (!bucket) continue
        for (const id of bucket) {
          if (Math.hypot(pts[id].x - p.x, pts[id].z - p.z) <= tol) return id
        }
      }
    }
    const id = pts.length
    pts.push({ x: p.x, z: p.z })
    const key = `${cx}:${cz}`
    const bucket = cells.get(key)
    if (bucket) bucket.push(id)
    else cells.set(key, [id])
    return id
  }

  const segs: Seg[] = []
  for (const w of walls) {
    if (!w || !usable(w.a) || !usable(w.b)) continue
    // A wall shorter than the welding tolerance cannot be told apart from a
    // double-tap, so it never becomes an edge.
    if (Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) <= tol) continue
    const a = add(w.a)
    const b = add(w.b)
    if (a !== b) segs.push({ a, b })
  }
  return { pts, segs, add }
}

/** Register the crossing point of every genuine X so the split step can use it. */
function addCrossings(n: Welded): void {
  for (let i = 0; i < n.segs.length; i++) {
    for (let j = i + 1; j < n.segs.length; j++) {
      const hit = crossing(
        n.pts[n.segs[i].a], n.pts[n.segs[i].b],
        n.pts[n.segs[j].a], n.pts[n.segs[j].b],
      )
      if (hit) n.add(hit)
    }
  }
}

function crossing(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const rx = p2.x - p1.x, rz = p2.z - p1.z
  const sx = p4.x - p3.x, sz = p4.z - p3.z
  const denom = rx * sz - rz * sx
  // Parallel or collinear: no single crossing point to add. Overlapping
  // collinear walls are handled by welding plus the on-segment split instead.
  if (Math.abs(denom) < 1e-12) return null
  const qx = p3.x - p1.x, qz = p3.z - p1.z
  const t = (qx * sz - qz * sx) / denom
  const u = (qx * rz - qz * rx) / denom
  if (!Number.isFinite(t) || !Number.isFinite(u)) return null
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  const out = { x: p1.x + t * rx, z: p1.z + t * rz }
  // Absurd coordinates overflow the cross products to Infinity, and NaN slips
  // past the parallel guard above. Never hand a non-finite point downstream.
  return Number.isFinite(out.x) && Number.isFinite(out.z) ? out : null
}

/**
 * Cut every segment at each node lying on its interior and return the resulting
 * undirected edges, deduplicated.
 *
 * This is what makes T-junctions work: an internal partition meeting an
 * exterior wall mid-span leaves the exterior wall as one long edge that the
 * face walk can never turn off, so the two rooms either side never close.
 */
function splitSegments(n: Welded, tol: number): [number, number][] {
  const edges = new Map<string, [number, number]>()
  for (const s of n.segs) {
    const a = n.pts[s.a]
    const b = n.pts[s.b]
    const dx = b.x - a.x, dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    if (len2 === 0) continue

    const on: { id: number; t: number }[] = []
    for (let id = 0; id < n.pts.length; id++) {
      const p = n.pts[id]
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2
      if (t < 0 || t > 1) continue
      if (Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z) > tol) continue
      on.push({ id, t })
    }
    on.sort((m, o) => m.t - o.t)

    for (let k = 1; k < on.length; k++) {
      const u = on[k - 1].id
      const v = on[k].id
      if (u === v) continue
      const key = u < v ? `${u}:${v}` : `${v}:${u}`
      if (!edges.has(key)) edges.set(key, [u, v])
    }
  }
  return [...edges.values()]
}

/**
 * Walk the planar embedding. Sort the edges around each node by angle; on
 * arriving at a node, leave by the edge one step clockwise from the one you
 * came in on. Every directed half-edge then belongs to exactly one face, and
 * interior faces come out counter-clockwise while outer faces come out
 * clockwise — which is how the outer face is identified, by the sign of its
 * area rather than by assuming it is the biggest.
 */
function facesOf(pts: Pt[], edges: [number, number][], tol: number): Pt[][] {
  const adj: number[][] = pts.map(() => [])
  for (const [u, v] of edges) {
    adj[u].push(v)
    adj[v].push(u)
  }
  const rank: Map<number, number>[] = pts.map(() => new Map())
  for (let u = 0; u < adj.length; u++) {
    const from = pts[u]
    adj[u].sort((m, o) =>
      Math.atan2(pts[m].z - from.z, pts[m].x - from.x) -
      Math.atan2(pts[o].z - from.z, pts[o].x - from.x))
    adj[u].forEach((v, i) => rank[u].set(v, i))
  }

  const walked = new Set<string>()
  const limit = edges.length * 2 + 8
  const faces: Pt[][] = []

  for (let start = 0; start < adj.length; start++) {
    for (const first of adj[start]) {
      if (walked.has(`${start}>${first}`)) continue
      const loop: number[] = []
      let from = start
      let to = first
      let closed = false
      for (let step = 0; step <= limit; step++) {
        walked.add(`${from}>${to}`)
        loop.push(from)
        const ring = adj[to]
        const i = rank[to].get(from)
        if (i === undefined) break
        const next = ring[(i - 1 + ring.length) % ring.length]
        from = to
        to = next
        if (from === start && to === first) { closed = true; break }
      }
      if (!closed) continue

      const poly = tidy(loop, pts, tol)
      if (poly.length < 3) continue
      // Negative area is an outer face; a positive but tiny one is a sliver.
      // Surviving faces are already counter-clockwise.
      if (polygonArea(poly) < MIN_AREA) continue
      faces.push(poly)
    }
  }
  return faces
}

/**
 * Turn a raw face loop into a room polygon: drop repeats, retract the there-and
 * -back spurs a dangling wall leaves behind, then drop the intermediate
 * vertices that splitting introduced along straight runs.
 */
function tidy(loop: number[], pts: Pt[], tol: number): Pt[] {
  let ids = loop.filter((id, i) => id !== loop[(i + 1) % loop.length])
  ids = retractSpurs(ids)
  if (ids.length < 3) return []
  return dropCollinear(ids.map(id => pts[id]), tol)
}

function retractSpurs(ids: number[]): number[] {
  let changed = true
  while (changed && ids.length >= 3) {
    changed = false
    for (let i = 0; i < ids.length; i++) {
      const n = ids.length
      if (ids[(i - 1 + n) % n] !== ids[(i + 1) % n]) continue
      const tip = i
      const back = (i + 1) % n
      ids = ids.filter((_, k) => k !== tip && k !== back)
      changed = true
      break
    }
  }
  return ids
}

/**
 * Remove vertices that add no shape.
 *
 * Deviation is measured against the ORIGINAL ring, never against the
 * already-simplified one. Comparing each vertex to its current neighbours
 * moves the reference chord every time a point is dropped, so the error
 * compounds: a wall traced as many short segments loses area without bound —
 * a circle traced in 448 steps came back as a quadrilateral missing a third of
 * its floor. Validating the whole spanned arc keeps the result within `tol` of
 * what was drawn.
 */
function dropCollinear(poly: Pt[], tol: number): Pt[] {
  const n = poly.length
  if (n <= 3) return poly

  const keep = new Array<boolean>(n).fill(true)

  /** Furthest any original vertex strictly between i and k sits off the chord. */
  const deviation = (i: number, k: number): number => {
    const a = poly[i], b = poly[k]
    const dx = b.x - a.x, dz = b.z - a.z
    const span = Math.hypot(dx, dz)
    let worst = 0
    for (let j = (i + 1) % n; j !== k; j = (j + 1) % n) {
      const p = poly[j]
      const off = span < 1e-9
        ? Math.hypot(p.x - a.x, p.z - a.z)
        : Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / span
      if (off > worst) worst = off
      if (worst > tol) return worst
    }
    return worst
  }

  const prevKept = (i: number) => { let j = (i - 1 + n) % n; while (!keep[j] && j !== i) j = (j - 1 + n) % n; return j }
  const nextKept = (i: number) => { let j = (i + 1) % n; while (!keep[j] && j !== i) j = (j + 1) % n; return j }

  let kept = n
  let changed = true
  while (changed && kept > 3) {
    changed = false
    for (let i = 0; i < n && kept > 3; i++) {
      if (!keep[i]) continue
      const a = prevKept(i), b = nextKept(i)
      if (a === i || b === i || a === b) continue
      keep[i] = false
      if (deviation(a, b) > tol) { keep[i] = true; continue }
      kept--
      changed = true
    }
  }
  return poly.filter((_, i) => keep[i])
}
