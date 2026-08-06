/**
 * Phone orientation readings → a camera rotation, for stitching a panorama out
 * of photos taken while turning on the spot.
 *
 * Three conventions meet in this file and each one is a chance to be quietly
 * wrong, so all three are written down rather than implied.
 *
 * 1. THE READING. `DeviceOrientationEvent` reports alpha/beta/gamma as an
 *    INTRINSIC Z-X'-Y'' sequence in degrees: rotate about the device's Z, then
 *    about the once-rotated X', then about the twice-rotated Y'' (W3C
 *    DeviceOrientation Event Specification, "Deviceorientation event" and its
 *    worked rotation matrix). Composed left to right that is
 *
 *        R_device = Rz(alpha) · Rx(beta) · Ry(gamma)
 *
 *    which maps DEVICE coordinates into the EARTH frame. The spec fixes the
 *    Earth frame as east-north-up — X east, Y true north, Z away from the
 *    centre of the Earth — and the device frame as X to the right of the
 *    screen, Y up the screen, Z out of the screen towards the viewer. So
 *    alpha, beta and gamma are NOT yaw, pitch and roll: alpha turns about the
 *    world's vertical, but beta and gamma turn about axes that have already
 *    moved. Reading them as if they were independent is the usual bug.
 *
 *    The browser guarantees alpha in [0,360), beta in [-180,180) and gamma in
 *    [-90,90). Nothing below depends on that — the trigonometry is periodic —
 *    but a reading outside those ranges means the source is not really a
 *    DeviceOrientationEvent.
 *
 * 2. THE SCREEN. `screen.orientation.angle` (or the deprecated
 *    `window.orientation`) is how far the page has been turned away from the
 *    device's natural orientation, about the axis coming out of the screen.
 *    The device frame turns with the hardware but the photograph is framed by
 *    the screen, so the reading has to be undone in DEVICE coordinates, on the
 *    RIGHT: `· Rz(-angle)`. Without it a phone shot in landscape yields a
 *    panorama rolled by ninety degrees. Sign and placement follow three.js
 *    `DeviceOrientationControls`, which is the field-tested reference. It is a
 *    parameter and never a global read, so this module runs under Node.
 *
 * 3. THE CAMERA. The result is a camera-to-world rotation for a camera that
 *    looks down its own -Z with +Y up — the OpenGL/three.js convention. That
 *    needs no extra correction on the right, and here is the assumption behind
 *    that claim: THE PHOTOGRAPH COMES FROM THE REAR CAMERA, which looks along
 *    device -z (out through the back of the screen) with the top edge of the
 *    phone, device +y, as the top of the image. Those are already the camera's
 *    -Z and +Y. A front-facing (selfie) camera looks the opposite way and would
 *    need a further half turn about Y; feeding it in here gives a panorama
 *    inside out.
 *
 *    What does change is the world frame. The Earth frame above is Z-up, while
 *    house coordinates in this app are metres with x east, y up, z south (see
 *    CLAUDE.md) — the right-handed Y-up frame the renderer wants. That is one
 *    fixed change of basis, Rx(-90), applied on the LEFT.
 *
 * Putting it together:
 *
 *        R = ENU_TO_WORLD · Rz(alpha) · Rx(beta) · Ry(gamma) · Rz(-screen)
 *            └ world frame ┘└──────── device attitude ───────┘└── screen ──┘
 *
 * Worth holding on to as a sanity check: a phone lying flat on a table, screen
 * up and top edge pointing north, reads (0, 0, 0) and gives a camera looking
 * straight down with north at the top of the frame. A phone held upright in
 * portrait facing north reads (0, 90, 0) and gives exactly the identity.
 */

export interface Euler {
  /** Degrees about the Earth's vertical, [0, 360). Anticlockwise seen from above. */
  alpha: number
  /** Degrees about the once-rotated X', [-180, 180). Tilt of the screen off flat. */
  beta: number
  /** Degrees about the twice-rotated Y'', [-90, 90). */
  gamma: number
}

/**
 * ROW-major 3x3: [m00, m01, m02, m10, m11, m12, m20, m21, m22].
 *
 * Row-major because it reads like the maths above and like `THREE.Matrix3.set`,
 * which also takes its arguments in row order. `Matrix3.fromArray` and the
 * `.elements` field are column-major and will silently transpose this.
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export interface Vec3 { x: number; y: number; z: number }

export interface YawPitchRoll {
  /** Degrees clockwise from north seen from above, [0, 360). 0 north, 90 east. */
  yaw: number
  /** Degrees above the horizon, [-90, 90]. */
  pitch: number
  /** Degrees of rotation about the view axis, right-hand-down positive, [-180, 180]. */
  roll: number
}

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/**
 * Below this cosine of pitch, yaw and roll stop being separable: pointing
 * straight up or down leaves only their sum, so no threshold can recover both.
 * Small enough that ordinary readings never reach it, large enough that the
 * atan2 either side of it is not being fed pure rounding error.
 */
const LOCK_EPS = 1e-7

/** A fresh identity. Returned rather than shared so callers cannot mutate it. */
export const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * Earth (east, north, up) → house plan-space (east, up, south).
 *
 * Numerically this is Rx(-90), and it is the ONLY reason the neutral reading
 * does not come back as the identity matrix.
 */
const ENU_TO_WORLD: Mat3 = [
  1, 0, 0,
  0, 0, 1,
  0, -1, 0,
]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isMat3 = (m: unknown): m is Mat3 =>
  Array.isArray(m) && m.length === 9 && m.every(finite)

const isVec3 = (v: unknown): v is Vec3 =>
  !!v && finite((v as Vec3).x) && finite((v as Vec3).y) && finite((v as Vec3).z)

/** Degrees folded into [0, 360). */
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v)

function rotZ(deg: number): Mat3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

function rotX(deg: number): Mat3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

function rotY(deg: number): Mat3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  if (!isMat3(a) || !isMat3(b)) return identity()
  const out = new Array<number>(9)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
    }
  }
  return out as Mat3
}

export function transpose(m: Mat3): Mat3 {
  if (!isMat3(m)) return identity()
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

/**
 * The inverse of a rotation is its transpose, so this is how you go from world
 * coordinates back into the camera's own frame — which is what projecting a
 * pixel of one photo into the panorama needs.
 */
export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  if (!isVec3(v)) return { x: 0, y: 0, z: 0 }
  const t = isMat3(m) ? m : identity()
  return {
    x: t[0] * v.x + t[1] * v.y + t[2] * v.z,
    y: t[3] * v.x + t[4] * v.y + t[5] * v.z,
    z: t[6] * v.x + t[7] * v.y + t[8] * v.z,
  }
}

/**
 * Camera-to-world rotation for one reading.
 *
 * `screenAngleDeg` is `screen.orientation.angle`. Left out it means "the screen
 * is in its natural orientation"; passed as a non-finite number it means the
 * caller's own state is broken, and a neutral answer beats a poisoned one.
 */
export function deviceToRotation(e: Euler, screenAngleDeg = 0): Mat3 {
  if (!e || !finite(e.alpha) || !finite(e.beta) || !finite(e.gamma)) return identity()
  if (!finite(screenAngleDeg)) return identity()

  const a = e.alpha * DEG, b = e.beta * DEG, g = e.gamma * DEG
  const cA = Math.cos(a), sA = Math.sin(a)
  const cB = Math.cos(b), sB = Math.sin(b)
  const cG = Math.cos(g), sG = Math.sin(g)

  // Rz(alpha) · Rx(beta) · Ry(gamma), written out as in the W3C worked example
  // rather than composed, so it can be checked against the spec by eye.
  const device: Mat3 = [
    cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG,
    sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG,
    -cB * sG, sB, cB * cG,
  ]

  return multiply(ENU_TO_WORLD, multiply(device, rotZ(-screenAngleDeg)))
}

/** Where the camera points, in world coordinates: the negated third column. */
export function lookVector(m: Mat3): Vec3 {
  const t = isMat3(m) ? m : identity()
  return { x: -t[2], y: -t[5], z: -t[8] }
}

/**
 * Decompose into the angles a person can picture.
 *
 * The inverse of `rotationFromYawPitchRoll`, i.e. of Ry(-yaw)·Rx(pitch)·Rz(-roll).
 * Straight up and straight down are singular: only yaw minus roll (or plus, at
 * the other pole) survives the rotation, so the split between them is a free
 * choice. Roll is given away and yaw takes the whole angle — the choice that
 * keeps a camera pointed at the ceiling from reporting a wild roll, and the
 * reason no branch here can produce a NaN.
 */
export function rotationToYawPitchRoll(m: Mat3): YawPitchRoll {
  const t = isMat3(m) ? m : identity()

  // m12 is -sin(pitch); clamped because a matrix that has been through a few
  // multiplications can land a hair outside [-1, 1] and asin would give NaN.
  const sinPitch = clamp1(-t[5])
  const pitch = Math.asin(sinPitch)
  const cosPitch = Math.cos(pitch)

  if (cosPitch > LOCK_EPS) {
    return {
      yaw: norm360(Math.atan2(-t[2], t[8]) * RAD),
      pitch: pitch * RAD,
      roll: Math.atan2(-t[3], t[4]) * RAD,
    }
  }

  // Gimbal lock. Both remaining entries of the top row carry the same combined
  // angle, so read it there; the sign flips with the pole.
  const combined = sinPitch > 0
    ? Math.atan2(t[1], t[0])
    : Math.atan2(-t[1], t[0])
  return {
    yaw: norm360(-combined * RAD),
    pitch: pitch * RAD,
    roll: 0,
  }
}

/**
 * Rebuild a camera rotation from the angles.
 *
 * Yaw turns about the world's vertical, then pitch about the camera's own X,
 * then roll about the camera's own Z. The negated yaw and roll are what make
 * the two of them read the way people expect in a right-handed Y-up frame:
 * yaw clockwise from above (north, east, south, west) and roll positive when
 * the right-hand side of the frame drops.
 */
export function rotationFromYawPitchRoll(yaw: number, pitch: number, roll: number): Mat3 {
  if (!finite(yaw) || !finite(pitch) || !finite(roll)) return identity()
  return multiply(rotY(-yaw), multiply(rotX(pitch), rotZ(-roll)))
}
