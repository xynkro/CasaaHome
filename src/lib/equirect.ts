/**
 * Equirectangular stitching: a dozen phone photos taken from one spot become
 * one panorama you can look around inside.
 *
 * The phone reports its attitude with every frame, so the geometry is already
 * known — there is nothing to solve, no features to match, no bundle to
 * adjust. What is left is resampling, and the robust direction is INVERSE:
 * walk the output pixels and ask each photo what it saw there. Forward mapping
 * (walk the input, scatter into the output) tears holes wherever the
 * projection stretches, and the stretch towards the poles is unbounded.
 *
 * Frames, fixed once so nothing downstream has to guess:
 *   World is the house frame — x east, y up, z south.
 *   Longitude 0 points along +x and increases towards +z; latitude +90 is +y.
 *   Camera is x right, y DOWN, z forward, which is what a 3x3 world->camera
 *   attitude matrix from a phone already uses.
 *
 * No DOM, no canvas, no ImageBitmap: this has to run unchanged inside a Worker
 * once the capture flow exists, and in Node for the tests.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Shot {
  width: number
  height: number
  /** Row-major RGBA, length width*height*4. */
  pixels: Uint8ClampedArray
  /** Camera rotation as a 3x3 row-major matrix, world -> camera. */
  rotation: number[]
  /** Horizontal field of view in degrees. */
  hFovDeg: number
}

export interface StitchResult {
  width: number
  height: number
  pixels: Uint8ClampedArray
  /** 0..1 per output pixel: how much real photo data landed there. */
  coverage: Float32Array
  coveredFraction: number
}

const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2
const DEG = Math.PI / 180

/**
 * 2048x1024 is enough for a room. A room is looked at from a few metres, and
 * 360 degrees over 2048 columns is 0.18 degrees per pixel — about 9 mm at 3 m,
 * finer than the hand shake between a dozen handheld frames, so a larger
 * canvas would only render the blur bigger. It is also the largest texture
 * every mobile GPU still in circulation accepts without dropping to software,
 * and the accumulators below cost 8 MB here against 32 MB at 4096 — on a phone
 * that is still holding the source frames.
 */
const DEFAULT_WIDTH = 2048
const DEFAULT_HEIGHT = 1024

/** Fraction of each half-frame over which a shot fades out at its edge. */
const DEFAULT_FEATHER = 0.25

/** How much of each frame a neighbouring frame should repeat. */
const DEFAULT_OVERLAP = 0.35

/**
 * A shot at or beyond 180 degrees cannot be a pinhole — the projection is
 * infinite at 180 — so anything that wide is read as already-spherical
 * imagery (an existing panorama being re-projected) rather than rejected.
 */
const SPHERICAL_FROM_DEG = 180

/** Border samples per frame edge when bounding a shot in equirect space. */
const EDGE_SAMPLES = 32

/** Slack in output pixels around a shot's bounding box. */
const BOX_PAD = 2

export function equirectDirection(u: number, v: number): Vec3 {
  const lon = (u - 0.5) * TAU
  const lat = (0.5 - v) * Math.PI
  const c = Math.cos(lat)
  return { x: c * Math.cos(lon), y: Math.sin(lat), z: c * Math.sin(lon) }
}

export function projectToShot(dir: Vec3, shot: Shot): { sx: number; sy: number } | null {
  const lens = lensOf(shot)
  if (!lens) return null
  if (!dir || !Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z)) return null
  const R = shot.rotation
  return project(
    R[0] * dir.x + R[1] * dir.y + R[2] * dir.z,
    R[3] * dir.x + R[4] * dir.y + R[5] * dir.z,
    R[6] * dir.x + R[7] * dir.y + R[8] * dir.z,
    shot, lens,
  )
}

/**
 * Vertical field of view implied by a frame's aspect ratio.
 *
 * NOT hFov * height / width: a rectilinear lens maps angle through a tangent,
 * so scaling the angle with the side lengths overstates the vertical reach by
 * several degrees on a phone — enough to leave a gap between rows of shots
 * that were planned as if it were exact.
 */
export function verticalFovDeg(width: number, height: number, hFovDeg: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  if (!Number.isFinite(hFovDeg) || hFovDeg <= 0 || hFovDeg >= SPHERICAL_FROM_DEG) return null
  const focal = (width / 2) / Math.tan(hFovDeg * DEG / 2)
  return 2 * Math.atan((height / 2) / focal) / DEG
}

/**
 * World -> camera rotation for a camera pointed at a given yaw (longitude) and
 * pitch (latitude), held level. Rows are the camera's right, down and forward
 * axes expressed in world coordinates.
 */
export function rotationFromYawPitch(yawDeg: number, pitchDeg: number): number[] {
  const yaw = Number.isFinite(yawDeg) ? yawDeg : 0
  const pitch = Number.isFinite(pitchDeg) ? Math.min(Math.max(pitchDeg, -90), 90) : 0
  const f = equirectDirection(0.5 + yaw / 360, 0.5 - pitch / 180)

  // Straight up or down leaves the level-roll construction undefined; any
  // roll covers the same cap, so pick one rather than returning zeros.
  let rx = -f.z, ry = 0, rz = f.x
  const len = Math.hypot(rx, rz)
  if (len < 1e-9) { rx = 0; ry = 0; rz = 1 } else { rx /= len; rz /= len }

  const dx = f.y * rz - f.z * ry
  const dy = f.z * rx - f.x * rz
  const dz = f.x * ry - f.y * rx
  return [rx, ry, rz, dx, dy, dz, f.x, f.y, f.z]
}

/**
 * Where to point the phone to cover the whole sphere.
 *
 * Rows sit at fixed pitches, and the rows nearer a pole hold fewer shots
 * because their circle of latitude is shorter. The count uses the widest
 * latitude the row has to reach — its band edge nearest the equator — not the
 * latitude of its centre, because a row centred at 60 degrees still has to
 * close the ring down at 35, where the circle is half as long again.
 * Alternate rows are staggered by half a step so seams do not stack up into
 * one visible column.
 */
export function suggestTargets(
  hFovDeg: number,
  vFovDeg: number,
  overlap: number = DEFAULT_OVERLAP,
): { yaw: number; pitch: number }[] {
  if (!Number.isFinite(hFovDeg) || !Number.isFinite(vFovDeg)) return []
  const h = Math.min(Math.max(hFovDeg, 1), 170)
  const v = Math.min(Math.max(vFovDeg, 1), 170)
  const share = Number.isFinite(overlap) ? Math.min(Math.max(overlap, 0), 0.9) : DEFAULT_OVERLAP
  const advance = 1 - share

  // Rows are inclusive of both poles: a shot centred on a pole covers the cap
  // that the ring below can only reach with the dead outer edge of its frame,
  // where its blend weight has already fallen to zero.
  const rows = Math.max(3, Math.ceil(180 / (v * advance)) + 1)
  const gap = 180 / (rows - 1)
  const yawStep = h * advance

  const pitches = Array.from({ length: rows }, (_, i) => 90 - i * gap)
  // Horizon first: that is the order a person actually turns on the spot.
  pitches.sort((a, b) => Math.abs(a) - Math.abs(b))

  const out: { yaw: number; pitch: number }[] = []
  pitches.forEach((pitch, row) => {
    if (Math.abs(pitch) >= 90 - 1e-9) {
      out.push({ yaw: 0, pitch })
      return
    }
    const widest = Math.max(0, Math.abs(pitch) - v / 2)
    const count = Math.max(1, Math.ceil(360 * Math.cos(widest * DEG) / yawStep))
    const step = 360 / count
    const stagger = (row % 2) * 0.5
    for (let j = 0; j < count; j++) {
      let yaw = -180 + (j + stagger) * step
      if (yaw >= 180) yaw -= 360
      out.push({ yaw, pitch })
    }
  })
  return out
}

export function stitchEquirect(
  shots: Shot[],
  opts?: { width?: number; height?: number; feather?: number },
): StitchResult {
  const width = sizeOf(opts?.width, DEFAULT_WIDTH)
  // An equirectangular image is 2:1 by definition, so a caller who resizes one
  // side means both; deriving the other stops a silently squashed panorama.
  const height = opts?.height === undefined && opts?.width !== undefined
    ? Math.max(1, Math.round(width / 2))
    : sizeOf(opts?.height, DEFAULT_HEIGHT)
  const feather = Number.isFinite(opts?.feather)
    ? Math.min(Math.max(opts?.feather as number, 0), 1)
    : DEFAULT_FEATHER

  const n = width * height
  const pixels = new Uint8ClampedArray(n * 4)
  const coverage = new Float32Array(n)
  const empty = { width, height, pixels, coverage, coveredFraction: 0 }
  if (!Array.isArray(shots) || shots.length === 0) return empty

  const acc = new Float32Array(n * 3)
  const wsum = new Float32Array(n)

  const cosLon = new Float64Array(width)
  const sinLon = new Float64Array(width)
  for (let x = 0; x < width; x++) {
    const lon = ((x + 0.5) / width - 0.5) * TAU
    cosLon[x] = Math.cos(lon)
    sinLon[x] = Math.sin(lon)
  }

  let used = 0
  for (const shot of shots) {
    const lens = lensOf(shot)
    if (!lens) continue
    const sw = shot.width
    const sh = shot.height
    const src = shot.pixels
    if (!src || src.length < sw * sh * 4) continue

    const box = boundsOf(shot, lens, width, height)
    if (!box) continue
    used++

    const R = shot.rotation
    for (let y = box.y0; y <= box.y1; y++) {
      const lat = (0.5 - (y + 0.5) / height) * Math.PI
      const cosLat = Math.cos(lat)
      const sinLat = Math.sin(lat)
      // The latitude half of the rotation is constant along a row.
      const b0 = R[1] * sinLat
      const b1 = R[4] * sinLat
      const b2 = R[7] * sinLat
      const row = y * width

      for (const span of box.cols) {
        for (let x = span[0]; x <= span[1]; x++) {
          const cl = cosLon[x], sl = sinLon[x]
          const cz = cosLat * (R[6] * cl + R[8] * sl) + b2
          const cx = cosLat * (R[0] * cl + R[2] * sl) + b0
          const cy = cosLat * (R[3] * cl + R[5] * sl) + b1

          let sx: number, sy: number
          if (lens.spherical) {
            const lon = Math.atan2(cx, cz)
            const alt = Math.atan2(-cy, Math.hypot(cx, cz))
            sx = sw * (0.5 + lon / lens.lonSpan)
            sy = sh * (0.5 - alt / lens.latSpan)
            if (sx < 0 || sx > sw || sy < 0 || sy > sh) continue
          } else {
            if (!(cz > 0)) continue
            sx = sw * 0.5 + lens.focal * cx / cz
            sy = sh * 0.5 + lens.focal * cy / cz
            if (sx < 0 || sx > sw || sy < 0 || sy > sh) continue
          }

          const wx = lens.featherX ? ramp(sx / sw, feather) : 1
          if (wx <= 0) continue
          const wy = lens.featherY ? ramp(sy / sh, feather) : 1
          const w = wx * wy
          if (w <= 0) continue

          // Bilinear, inlined: this runs a few million times per stitch and a
          // helper returning a triple would allocate on every one of them.
          const fx = sx - 0.5, fy = sy - 0.5
          let x0 = Math.floor(fx), y0 = Math.floor(fy)
          const tx = fx - x0, ty = fy - y0
          let x1 = x0 + 1, y1 = y0 + 1
          if (x0 < 0) x0 = 0; else if (x0 > sw - 1) x0 = sw - 1
          if (x1 < 0) x1 = 0; else if (x1 > sw - 1) x1 = sw - 1
          if (y0 < 0) y0 = 0; else if (y0 > sh - 1) y0 = sh - 1
          if (y1 < 0) y1 = 0; else if (y1 > sh - 1) y1 = sh - 1
          const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4
          const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4
          const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty)
          const w01 = (1 - tx) * ty, w11 = tx * ty

          const o = (row + x) * 3
          acc[o] += w * (src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11)
          acc[o + 1] += w * (src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11)
          acc[o + 2] += w * (src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11)
          wsum[row + x] += w
        }
      }
    }
  }
  if (used === 0) return empty

  let covered = 0
  for (let i = 0; i < n; i++) {
    const w = wsum[i]
    if (w <= 0) continue
    const o = i * 3, p = i * 4
    pixels[p] = Math.round(acc[o] / w)
    pixels[p + 1] = Math.round(acc[o + 1] / w)
    pixels[p + 2] = Math.round(acc[o + 2] / w)
    pixels[p + 3] = 255
    // Weight doubles as the confidence: a pixel seen only by the dead edge of
    // one frame carries almost no real data, however exact its colour is.
    const c = w > 1 ? 1 : w
    coverage[i] = c
    covered += c
  }
  return { width, height, pixels, coverage, coveredFraction: covered / n }
}

interface Lens {
  spherical: boolean
  focal: number
  lonSpan: number
  latSpan: number
  featherX: boolean
  featherY: boolean
}

function lensOf(shot: Shot | undefined | null): Lens | null {
  if (!shot) return null
  const w = shot.width, h = shot.height
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null
  const fov = shot.hFovDeg
  if (!Number.isFinite(fov) || fov <= 0 || fov > 360) return null
  const R = shot.rotation
  if (!R || R.length < 9) return null
  for (let i = 0; i < 9; i++) if (!Number.isFinite(R[i])) return null
  if (!isRotation(R)) return null

  if (fov >= SPHERICAL_FROM_DEG) {
    const latSpan = Math.min(180, fov * h / w) * DEG
    if (!(latSpan > 0)) return null
    return {
      spherical: true, focal: 0, lonSpan: fov * DEG, latSpan,
      // Nothing to hide where the frame wraps onto itself or ends at a pole;
      // feathering there would carve a hole out of a complete sphere.
      featherX: fov < 360,
      featherY: latSpan < Math.PI - 1e-9,
    }
  }
  return {
    spherical: false,
    focal: (w / 2) / Math.tan(fov * DEG / 2),
    lonSpan: 0, latSpan: 0, featherX: true, featherY: true,
  }
}

/**
 * The bounding box below inverts the attitude by transposing it, which is only
 * the inverse for a true rotation. A caller that hands over a scaled or skewed
 * matrix would get a box that does not contain the pixels it claims to, so
 * such a shot is refused outright rather than stitched into the wrong place.
 */
function isRotation(R: number[]): boolean {
  const tol = 1e-3
  for (let i = 0; i < 3; i++) {
    const a = R[i * 3], b = R[i * 3 + 1], c = R[i * 3 + 2]
    if (Math.abs(a * a + b * b + c * c - 1) > tol) return false
    for (let j = i + 1; j < 3; j++) {
      const dot = a * R[j * 3] + b * R[j * 3 + 1] + c * R[j * 3 + 2]
      if (Math.abs(dot) > tol) return false
    }
  }
  return true
}

function project(cx: number, cy: number, cz: number, shot: Shot, lens: Lens):
  { sx: number; sy: number } | null {
  if (lens.spherical) {
    const lon = Math.atan2(cx, cz)
    const alt = Math.atan2(-cy, Math.hypot(cx, cz))
    const sx = shot.width * (0.5 + lon / lens.lonSpan)
    const sy = shot.height * (0.5 - alt / lens.latSpan)
    if (!(sx >= 0 && sx <= shot.width && sy >= 0 && sy <= shot.height)) return null
    return { sx, sy }
  }
  if (!(cz > 0)) return null
  const sx = shot.width * 0.5 + lens.focal * cx / cz
  const sy = shot.height * 0.5 + lens.focal * cy / cz
  if (!(sx >= 0 && sx <= shot.width && sy >= 0 && sy <= shot.height)) return null
  return { sx, sy }
}

/** Weight across one axis of a frame: 1 in the middle, 0 at either edge. */
function ramp(t: number, feather: number): number {
  if (feather <= 0) return 1
  const d = 2 * Math.min(t, 1 - t)
  return d >= feather ? 1 : d / feather
}

function sizeOf(asked: number | undefined, fallback: number): number {
  if (!Number.isFinite(asked) || (asked as number) < 16) return fallback
  return Math.min(Math.floor(asked as number), 8192)
}

interface Box { y0: number; y1: number; cols: [number, number][] }

/**
 * Where a shot can possibly land in the output.
 *
 * Iterating every output pixel for every shot is 40 million projections for a
 * modest capture, so each shot is bounded first. The box comes from the frame
 * BORDER, sampled all the way round rather than at the four corners: a wide
 * lens bulges, so the extreme latitude of a tilted frame usually sits in the
 * middle of an edge and a corners-only box clips the top off the shot.
 *
 * Longitude cannot be min/maxed directly — a frame straddling the seam would
 * come back spanning the entire sphere. The covered arc is instead the
 * complement of the widest gap between the samples, and if that arc crosses
 * the seam the box is returned as two spans.
 */
function boundsOf(shot: Shot, lens: Lens, W: number, H: number): Box | null {
  const all: [number, number][] = [[0, W - 1]]
  // A shot this wide can reach anywhere, and its border wraps onto itself, so
  // the arc trick below has no gap to find.
  if (lens.spherical && shot.hFovDeg >= 360) return { y0: 0, y1: H - 1, cols: all }

  const R = shot.rotation
  const sw = shot.width, sh = shot.height
  const lons: number[] = []
  let latMin = Infinity, latMax = -Infinity

  const add = (sx: number, sy: number) => {
    let cx: number, cy: number, cz: number
    if (lens.spherical) {
      const lon = (sx / sw - 0.5) * lens.lonSpan
      const alt = (0.5 - sy / sh) * lens.latSpan
      const ca = Math.cos(alt)
      cx = ca * Math.sin(lon); cy = -Math.sin(alt); cz = ca * Math.cos(lon)
    } else {
      cx = (sx - sw / 2) / lens.focal; cy = (sy - sh / 2) / lens.focal; cz = 1
    }
    // Transpose is the inverse — isRotation has already guaranteed that.
    const x = R[0] * cx + R[3] * cy + R[6] * cz
    const y = R[1] * cx + R[4] * cy + R[7] * cz
    const z = R[2] * cx + R[5] * cy + R[8] * cz
    const lat = Math.atan2(y, Math.hypot(x, z))
    if (!Number.isFinite(lat)) return
    lons.push(Math.atan2(z, x))
    if (lat < latMin) latMin = lat
    if (lat > latMax) latMax = lat
  }

  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const t = i / EDGE_SAMPLES
    add(t * sw, 0)
    add(sw, t * sh)
    add(sw - t * sw, sh)
    add(0, sh - t * sh)
  }
  if (lons.length < 4) return null

  // Latitude and longitude have no interior extremes over a frame except at
  // the poles themselves, so the border carries the box unless a pole is in
  // shot — in which case longitude wraps right round and there is no arc.
  const north = project(R[1], R[4], R[7], shot, lens) !== null
  const south = project(-R[1], -R[4], -R[7], shot, lens) !== null
  if (north) latMax = HALF_PI
  if (south) latMin = -HALF_PI

  const y0 = clampInt(Math.floor((0.5 - latMax / Math.PI) * H) - BOX_PAD, 0, H - 1)
  const y1 = clampInt(Math.ceil((0.5 - latMin / Math.PI) * H) + BOX_PAD, 0, H - 1)
  if (y1 < y0) return null
  if (north || south) return { y0, y1, cols: all }

  lons.sort((a, b) => a - b)
  let gap = lons[0] + TAU - lons[lons.length - 1]
  let start = 0
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1]
    if (g > gap) { gap = g; start = i }
  }
  const lonA = lons[start]
  const lonB = lons[(start - 1 + lons.length) % lons.length]

  const colX = (lon: number) => (0.5 + lon / TAU) * W
  const a0 = Math.floor(colX(lonA)) - BOX_PAD
  const b1 = Math.ceil(colX(lonB)) + BOX_PAD
  const cols: [number, number][] = lonA <= lonB
    ? [[clampInt(a0, 0, W - 1), clampInt(b1, 0, W - 1)]]
    : [[clampInt(a0, 0, W - 1), W - 1], [0, clampInt(b1, 0, W - 1)]]
  return { y0, y1, cols }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
