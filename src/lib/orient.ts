import type { Pt, Wall } from '../types'

/**
 * Where a piece of furniture wants to sit.
 *
 * Positions are set by tapping a floorplan, and a tap is never square to
 * anything. Almost everything in a house has its back to a wall, so the guess
 * worth making is "nearest wall, flat against it, pushed out until it touches"
 * — while leaving the rare island unit where it was put rather than dragging it
 * across the kitchen.
 *
 * Rotation matches `StorageLocation.rotation`: degrees about the vertical axis,
 * where 0 runs the box's depth axis along +z so its back faces -z. Under the
 * usual right-handed rotation about y, a box's back points along
 * (-sin θ, -cos θ) in (x, z); putting that back against a wall whose outward
 * normal is n therefore means θ = atan2(n.x, n.z).
 */

/**
 * Beyond this a wall is scenery, not something to lean on. A kitchen island
 * two metres from anything is where it is on purpose.
 */
const DEFAULT_MAX_DISTANCE = 1.2

/** Below this a wall has no direction, only rounding error. */
const MIN_WALL_LENGTH = 1e-6

const DEG = 180 / Math.PI

export interface WallSnap {
  wall: Wall
  /** Metres from the point to the wall SEGMENT, corners included. */
  distance: number
  /** The point on the segment that measurement was taken to. */
  closest: Pt
  /** Rotation that puts a box's back flat against the wall, in [0, 360). */
  angleDeg: number
}

export interface Placement {
  position: Pt
  rotationDeg: number
  snapped: boolean
}

export function nearestWall(
  p: Pt,
  walls: Wall[],
  maxDistance = DEFAULT_MAX_DISTANCE,
): WallSnap | null {
  const hit = snap(p, walls, maxDistance)
  if (!hit) return null
  return { wall: hit.wall, distance: hit.distance, closest: hit.closest, angleDeg: hit.angleDeg }
}

export function suggestPlacement(
  p: Pt,
  walls: Wall[],
  depth: number,
  opts?: { maxDistance?: number },
): Placement {
  const stay: Placement = {
    position: { x: p?.x ?? NaN, z: p?.z ?? NaN },
    rotationDeg: 0,
    snapped: false,
  }

  const hit = snap(p, walls, opts?.maxDistance)
  if (!hit) return stay

  // Wall coordinates are its CENTRELINE, so clearing the face means clearing
  // half its thickness as well as half the depth of the box.
  const clearance = (positive(hit.wall.thickness) + positive(depth)) / 2
  const off = (p.x - hit.wall.a.x) * hit.normal.x + (p.z - hit.wall.a.z) * hit.normal.z
  const push = clearance - off

  // Perpendicular only. Sliding the piece along the wall would move it away
  // from the spot that was actually tapped, which is the one thing we know.
  return {
    position: { x: p.x + hit.normal.x * push, z: p.z + hit.normal.z * push },
    rotationDeg: hit.angleDeg,
    snapped: true,
  }
}

interface Snap extends WallSnap {
  /** Unit wall normal pointing towards the queried point. */
  normal: Pt
}

const usable = (p?: Pt | null): boolean =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.z)

const positive = (v?: number | null): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0

/** Degrees folded into [0, 360). */
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360

function snap(p: Pt, walls: Wall[], maxDistance?: number): Snap | null {
  if (!usable(p) || !Array.isArray(walls) || walls.length === 0) return null

  // Every comparison against a NaN limit is false, so an unchecked one would
  // not loosen the snap or tighten it — it would switch the feature off.
  const limit = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance >= 0
    ? maxDistance
    : DEFAULT_MAX_DISTANCE

  let best: Snap | null = null
  for (const w of walls) {
    const hit = snapToWall(p, w)
    // Strictly closer, so ties go to the earlier wall and an equidistant
    // corner does not flip its answer as unrelated walls are edited.
    if (hit && (!best || hit.distance < best.distance)) best = hit
  }
  return best && best.distance <= limit ? best : null
}

function snapToWall(p: Pt, w?: Wall | null): Snap | null {
  if (!w || !usable(w.a) || !usable(w.b)) return null

  const dx = w.b.x - w.a.x
  const dz = w.b.z - w.a.z
  const len = Math.hypot(dx, dz)
  if (!(len > MIN_WALL_LENGTH) || !Number.isFinite(len)) return null

  const ux = dx / len
  const uz = dz / len

  // Clamped to the segment: a point past the end of a wall is measured to that
  // corner, otherwise the stub in the next room would claim it off its own
  // infinite line.
  const along = Math.min(Math.max((p.x - w.a.x) * ux + (p.z - w.a.z) * uz, 0), len)
  const closest = { x: w.a.x + ux * along, z: w.a.z + uz * along }
  const distance = Math.hypot(p.x - closest.x, p.z - closest.z)
  // Coordinates big enough to overflow the projection give a NaN distance, and
  // NaN loses every comparison — such a wall would sit in `best` and lock out
  // every real wall considered after it. Drop it here instead.
  if (!Number.isFinite(distance)) return null

  // The normal is the wall's own, never the direction to `closest` — past the
  // end of a wall those differ, and it is the wall's that keeps the back FLAT
  // rather than skewed towards the corner.
  //
  // Left-hand normal, flipped to whichever side the point is on. A point
  // exactly on the centreline has no side, so the left normal stands as the
  // deterministic answer rather than a coin toss between two correct ones.
  const side = (p.x - w.a.x) * -uz + (p.z - w.a.z) * ux
  const sign = side < 0 ? -1 : 1
  const normal = { x: -uz * sign, z: ux * sign }

  return {
    wall: w,
    distance,
    closest,
    angleDeg: norm360(Math.atan2(normal.x, normal.z) * DEG),
    normal,
  }
}
