import type { Euler, Mat3, Vec3 } from '../src/lib/orientation'
import {
  applyMat3,
  deviceToRotation,
  identity,
  lookVector,
  multiply,
  rotationFromYawPitchRoll,
  rotationToYawPitchRoll,
  transpose,
} from '../src/lib/orientation'

let fails = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}`, cond ? '' : JSON.stringify(extra))
  if (!cond) fails++
}

const EPS = 1e-9

const e = (alpha: number, beta: number, gamma: number): Euler => ({ alpha, beta, gamma })

const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) < eps
const nearMat = (m: Mat3, n: Mat3, eps = EPS) => m.every((v, i) => Math.abs(v - n[i]) < eps)
const nearVec = (v: Vec3, w: Vec3, eps = EPS) =>
  near(v.x, w.x, eps) && near(v.y, w.y, eps) && near(v.z, w.z, eps)

/** Compare angles that wrap, so 180 and -180 (or 0 and 360) agree. */
const nearAngle = (a: number, b: number, eps = 1e-7) => {
  const d = ((a - b) % 360 + 540) % 360 - 180
  return Math.abs(d) < eps
}

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** mulberry32: same numbers on every machine, so a failure here is reproducible. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** World directions, house plan-space: x east, y up, z south. */
const NORTH = vec(0, 0, -1)
const SOUTH = vec(0, 0, 1)
const EAST = vec(1, 0, 0)
const WEST = vec(-1, 0, 0)
const UP = vec(0, 1, 0)
const DOWN = vec(0, -1, 0)

/** The camera's own up axis in world coordinates: the second column. */
const upVector = (m: Mat3): Vec3 => ({ x: m[1], y: m[4], z: m[7] })

const det = (m: Mat3) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6])

const row = (m: Mat3, i: number): Vec3 => ({ x: m[i * 3], y: m[i * 3 + 1], z: m[i * 3 + 2] })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z

/** Rows unit length, mutually perpendicular, right-handed. */
const orthonormal = (m: Mat3, eps = 1e-12): boolean => {
  for (let i = 0; i < 3; i++) {
    if (!near(dot(row(m, i), row(m, i)), 1, eps)) return false
    for (let j = i + 1; j < 3; j++) if (!near(dot(row(m, i), row(m, j)), 0, eps)) return false
  }
  return near(det(m), 1, eps)
}

const I = identity()

// --- the algebra underneath -------------------------------------------------
check('identity times identity is the identity', nearMat(multiply(I, I), I))
check('the identity leaves a vector alone', nearVec(applyMat3(I, vec(3, -4, 5)), vec(3, -4, 5)))
check('transposing twice gets you back', nearMat(transpose(transpose(I)), I))
check('the identity camera looks north with north-up unchanged',
  nearVec(lookVector(I), NORTH) && nearVec(upVector(I), UP))

{
  const m = deviceToRotation(e(37, 61, -22), 90)
  check('a rotation times its own transpose is the identity',
    nearMat(multiply(m, transpose(m)), I), m)
  check('transpose really is the inverse rotation',
    nearVec(applyMat3(transpose(m), applyMat3(m, vec(0.3, -0.7, 0.2))), vec(0.3, -0.7, 0.2)), m)
}

// --- the W3C sequence itself ------------------------------------------------
// The device matrix is hand-expanded in the module, which is the one place a
// sign could hide unnoticed. Rebuild it here by actually composing the three
// rotations of the intrinsic Z-X'-Y'' sequence and demand they agree.
{
  const rz = (d: number): Mat3 => {
    const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180)
    return [c, -s, 0, s, c, 0, 0, 0, 1]
  }
  const rx = (d: number): Mat3 => {
    const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180)
    return [1, 0, 0, 0, c, -s, 0, s, c]
  }
  const ry = (d: number): Mat3 => {
    const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180)
    return [c, 0, s, 0, 1, 0, -s, 0, c]
  }
  const enuToWorld: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0]

  const rnd = seeded(4242)
  let worst = 0
  for (let i = 0; i < 500; i++) {
    const r = e(rnd() * 360, rnd() * 360 - 180, rnd() * 180 - 90)
    const screen = [0, 90, 180, 270][Math.floor(rnd() * 4)]
    const composed = multiply(
      enuToWorld,
      multiply(multiply(rz(r.alpha), multiply(rx(r.beta), ry(r.gamma))), rz(-screen)),
    )
    const got = deviceToRotation(r, screen)
    worst = Math.max(worst, ...got.map((v, k) => Math.abs(v - composed[k])))
  }
  check('the expanded matrix is exactly Rz(alpha)*Rx(beta)*Ry(gamma), composed', worst < 1e-14, worst)
}

// --- the two neutral poses --------------------------------------------------
// Flat on the table, screen up, top edge north: the reading is all zeroes, and
// the rear camera is staring at the table with north at the top of the frame.
{
  const m = deviceToRotation(e(0, 0, 0))
  check('zeroed reading (phone flat, screen up) aims the camera straight down',
    nearVec(lookVector(m), DOWN), lookVector(m))
  check('and puts north at the top of that downward frame',
    nearVec(upVector(m), NORTH), upVector(m))
}

// Upright in portrait facing north is the frame everything else is measured
// against, so it must come back as EXACTLY the identity.
{
  const m = deviceToRotation(e(0, 90, 0))
  check('upright portrait facing north is the identity rotation', nearMat(m, I, 1e-15), m)
  const ypr = rotationToYawPitchRoll(m)
  check('and reads as yaw 0, pitch 0, roll 0',
    nearAngle(ypr.yaw, 0) && near(ypr.pitch, 0, 1e-7) && near(ypr.roll, 0, 1e-7), ypr)
}

// --- alpha alone ------------------------------------------------------------
// Held upright, alpha is the only thing turning: exactly the panorama motion.
// The spec's alpha runs ANTICLOCKWISE seen from above, so a compass bearing
// runs the other way — alpha 90 is a quarter turn to the west, not the east.
for (const [alpha, name, dir] of [
  [0, 'north', NORTH], [90, 'west', WEST], [180, 'south', SOUTH], [270, 'east', EAST],
] as [number, string, Vec3][]) {
  const m = deviceToRotation(e(alpha, 90, 0))
  const ypr = rotationToYawPitchRoll(m)
  check(`upright, alpha ${alpha} turns the camera anticlockwise to face ${name}`,
    nearVec(lookVector(m), dir, 1e-12), lookVector(m))
  check(`  and that reads as yaw ${norm(360 - alpha)}, level and unrolled`,
    nearAngle(ypr.yaw, 360 - alpha) && near(ypr.pitch, 0, 1e-7) && near(ypr.roll, 0, 1e-7), ypr)
}
function norm(d: number) { return ((d % 360) + 360) % 360 }

// --- beta alone -------------------------------------------------------------
// Beta is the tilt off flat, so from the upright pose (beta 90) it walks the
// camera up and down the north meridian: pitch = beta - 90.
for (const beta of [0, 45, 90, 135, 180]) {
  const ypr = rotationToYawPitchRoll(deviceToRotation(e(0, beta, 0)))
  check(`beta ${beta} tilts the camera to pitch ${beta - 90} (flat is straight down, upright is level)`,
    near(ypr.pitch, beta - 90, 1e-7), ypr)
}
{
  const down = lookVector(deviceToRotation(e(0, 45, 0)))
  check('  beta 45 leans the phone back, so the camera looks down and to the north',
    down.y < 0 && down.z < 0 && near(down.x, 0, 1e-12), down)
  const up = lookVector(deviceToRotation(e(0, 135, 0)))
  check('  beta 135 leans it past vertical, so the camera looks up and to the north',
    up.y > 0 && up.z < 0 && near(up.x, 0, 1e-12), up)
  check('  beta 180 (screen down on the table) aims the camera at the ceiling',
    nearVec(lookVector(deviceToRotation(e(0, 180, 0))), UP, 1e-12))
}

// --- gamma alone ------------------------------------------------------------
// From flat, gamma lifts one long edge of the phone. The camera swings off
// straight down by exactly that much, towards the west.
for (const gamma of [15, 30, 60]) {
  const ypr = rotationToYawPitchRoll(deviceToRotation(e(0, 0, gamma)))
  check(`flat, gamma ${gamma} lifts the camera ${gamma} degrees off straight down, facing west`,
    near(ypr.pitch, gamma - 90, 1e-7) && nearAngle(ypr.yaw, 270), ypr)
}
{
  const ypr = rotationToYawPitchRoll(deviceToRotation(e(0, 0, -30)))
  check('flat, a negative gamma swings the camera the other way, towards the east',
    near(ypr.pitch, 30 - 90, 1e-7) && nearAngle(ypr.yaw, 90), ypr)
}

// --- screen orientation -----------------------------------------------------
// The correction is a rotation about the camera's OWN view axis, whatever the
// phone is doing, so the difference between two screen angles must be exactly
// that and nothing else.
{
  const rollAbout = (deg: number): Mat3 => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180)
    return [c, -s, 0, s, c, 0, 0, 0, 1]
  }
  for (const reading of [e(0, 90, 0), e(53, -14, 71), e(310, 122, -85)]) {
    const base = deviceToRotation(reading, 0)
    for (const angle of [0, 90, 180, 270]) {
      const turned = deviceToRotation(reading, angle)
      check(`screen angle ${angle} is purely a roll about the view axis (alpha ${reading.alpha})`,
        nearMat(multiply(transpose(base), turned), rollAbout(-angle), 1e-12),
        multiply(transpose(base), turned))
    }
  }
}

// Measured from the level pose, that roll is the screen angle itself.
for (const angle of [0, 90, 180, 270]) {
  const ypr = rotationToYawPitchRoll(deviceToRotation(e(0, 90, 0), angle))
  check(`screen angle ${angle} rolls the camera by ${angle} degrees and leaves the aim alone`,
    nearAngle(ypr.roll, angle) && nearAngle(ypr.yaw, 0) && near(ypr.pitch, 0, 1e-7), ypr)
}

// iOS's deprecated window.orientation reports -90 where the Screen Orientation
// API reports 270. Both reach this function, and they have to mean the same
// thing or half the devices in the house come out upside down.
for (const [legacy, modern] of [[-90, 270], [180, -180], [0, 360]] as [number, number][]) {
  check(`screen angle ${legacy} and ${modern} are the same rotation`,
    nearMat(deviceToRotation(e(41, 17, -63), legacy), deviceToRotation(e(41, 17, -63), modern), 1e-14))
}

// The point of the whole correction: a phone shot in landscape must not come
// back rolled. Gamma +/-90 with beta 0 IS landscape — the phone stands upright
// with its long axis horizontal — and raw it is rolled a full quarter turn.
{
  const cw = e(0, 0, 90)
  const raw = rotationToYawPitchRoll(deviceToRotation(cw))
  check('landscape (gamma +90) is rolled 90 degrees if the screen angle is ignored',
    nearAngle(raw.roll, 90) && nearAngle(raw.yaw, 270) && near(raw.pitch, 0, 1e-7), raw)
  const fixed = rotationToYawPitchRoll(deviceToRotation(cw, 270))
  check('  and its screen angle of 270 takes the roll back out, aim untouched',
    nearAngle(fixed.roll, 0) && nearAngle(fixed.yaw, 270) && near(fixed.pitch, 0, 1e-7), fixed)

  const ccw = e(0, 0, -90)
  const rawCcw = rotationToYawPitchRoll(deviceToRotation(ccw))
  check('landscape the other way (gamma -90) is rolled -90 degrees',
    nearAngle(rawCcw.roll, -90) && nearAngle(rawCcw.yaw, 90), rawCcw)
  const fixedCcw = rotationToYawPitchRoll(deviceToRotation(ccw, 90))
  check('  and its screen angle of 90 takes that back out too',
    nearAngle(fixedCcw.roll, 0) && nearAngle(fixedCcw.yaw, 90), fixedCcw)
  check('  a landscape frame still has world up at the top once corrected',
    nearVec(upVector(deviceToRotation(ccw, 90)), UP, 1e-12),
    upVector(deviceToRotation(ccw, 90)))
}

// --- gimbal lock ------------------------------------------------------------
// Straight down and straight up leave yaw and roll indistinguishable. Nothing
// may go NaN, roll is given away, and the matrix must still rebuild exactly.
for (const [beta, pole, aim] of [[0, -90, DOWN], [180, 90, UP]] as [number, number, Vec3][]) {
  for (const alpha of [0, 50, 137.5, 359]) {
    const m = deviceToRotation(e(alpha, beta, 0))
    const ypr = rotationToYawPitchRoll(m)
    const finite = Number.isFinite(ypr.yaw) && Number.isFinite(ypr.pitch) && Number.isFinite(ypr.roll)
    check(`pitch ${pole} at alpha ${alpha} decomposes without a NaN`, finite, ypr)
    check(`  pitch reads exactly ${pole}, roll is given away as 0`,
      near(ypr.pitch, pole, 1e-7) && ypr.roll === 0, ypr)
    check(`  the aim is still straight ${pole > 0 ? 'up' : 'down'}`, nearVec(lookVector(m), aim, 1e-12))
    check('  and the locked angles still rebuild the exact same rotation',
      nearMat(rotationFromYawPitchRoll(ypr.yaw, ypr.pitch, ypr.roll), m, 1e-12), { m, ypr })
  }
}

// Just short of the pole the split is real again and must not be discarded.
{
  const m = rotationFromYawPitchRoll(123, 89.99, -45)
  const ypr = rotationToYawPitchRoll(m)
  check('a hair off the pole still separates yaw from roll',
    nearAngle(ypr.yaw, 123, 1e-4) && near(ypr.pitch, 89.99, 1e-4) && nearAngle(ypr.roll, -45, 1e-4), ypr)
}

// --- round trip and orthonormality over a seeded sweep ----------------------
{
  const rnd = seeded(20260805)
  const screens = [0, 90, 180, 270]
  let worstTrip = 0
  let worstOrtho = 0
  let allOrtho = true
  let allTrip = true
  let allLook = true
  for (let i = 0; i < 2000; i++) {
    // The ranges the browser actually guarantees.
    const reading = e(rnd() * 360, rnd() * 360 - 180, rnd() * 180 - 90)
    const screen = screens[Math.floor(rnd() * 4)]
    const m = deviceToRotation(reading, screen)

    if (!orthonormal(m)) { allOrtho = false; check('orthonormal', false, { reading, screen, m }) }
    for (let k = 0; k < 3; k++) {
      worstOrtho = Math.max(worstOrtho, Math.abs(dot(row(m, k), row(m, k)) - 1))
    }

    const ypr = rotationToYawPitchRoll(m)
    const inRange = ypr.yaw >= 0 && ypr.yaw < 360 &&
      ypr.pitch >= -90 && ypr.pitch <= 90 && ypr.roll >= -180 && ypr.roll <= 180
    if (!inRange) check('angles inside their declared ranges', false, { reading, screen, ypr })

    const back = rotationFromYawPitchRoll(ypr.yaw, ypr.pitch, ypr.roll)
    if (!orthonormal(back)) { allOrtho = false; check('rebuilt orthonormal', false, { ypr, back }) }
    const trip = Math.max(...back.map((v, k) => Math.abs(v - m[k])))
    worstTrip = Math.max(worstTrip, trip)
    if (trip > 1e-9) allTrip = false
    if (!nearVec(lookVector(back), lookVector(m), 1e-9)) allLook = false
  }
  check('2000 seeded readings all produce orthonormal, right-handed matrices', allOrtho,
    { worstRowNorm: worstOrtho })
  check('  worst row-length error stays at rounding level', worstOrtho < 1e-14, worstOrtho)
  check('yaw/pitch/roll round-trips back to the same matrix every time', allTrip, { worstTrip })
  check('  and therefore to the same look vector', allLook)
}

// A sweep the other way: angles in, matrix out, angles back.
{
  const rnd = seeded(77)
  let worst = 0
  for (let i = 0; i < 1000; i++) {
    const yaw = rnd() * 360
    // Kept off the poles, where the decomposition is deliberately not injective.
    const pitch = rnd() * 178 - 89
    const roll = rnd() * 360 - 180
    const got = rotationToYawPitchRoll(rotationFromYawPitchRoll(yaw, pitch, roll))
    const d = ((got.yaw - yaw) % 360 + 540) % 360 - 180
    worst = Math.max(worst, Math.abs(d), Math.abs(got.pitch - pitch),
      Math.abs(((got.roll - roll) % 360 + 540) % 360 - 180))
  }
  check('angles survive a trip through a matrix and back', worst < 1e-9, worst)
}

// --- non-finite input -------------------------------------------------------
for (const bad of [NaN, Infinity, -Infinity]) {
  check(`alpha ${String(bad)} falls back to the identity`, nearMat(deviceToRotation(e(bad, 30, 10)), I))
  check(`beta ${String(bad)} falls back to the identity`, nearMat(deviceToRotation(e(30, bad, 10)), I))
  check(`gamma ${String(bad)} falls back to the identity`, nearMat(deviceToRotation(e(30, 10, bad)), I))
  check(`screen angle ${String(bad)} falls back to the identity`,
    nearMat(deviceToRotation(e(30, 10, 5), bad), I))
}
check('a missing reading falls back to the identity',
  nearMat(deviceToRotation(null as unknown as Euler), I))
check('an omitted screen angle just means no screen rotation',
  nearMat(deviceToRotation(e(12, 34, 56)), deviceToRotation(e(12, 34, 56), 0)))

{
  const poisoned = [1, 0, 0, 0, NaN, 0, 0, 0, 1] as Mat3
  check('a poisoned matrix decomposes to zero angles rather than NaN',
    JSON.stringify(rotationToYawPitchRoll(poisoned)) === JSON.stringify({ yaw: 0, pitch: 0, roll: 0 }),
    rotationToYawPitchRoll(poisoned))
  check('a poisoned matrix looks north rather than nowhere', nearVec(lookVector(poisoned), NORTH))
  check('multiplying by a poisoned matrix gives the identity',
    nearMat(multiply(poisoned, I), I) && nearMat(multiply(I, poisoned), I))
  check('transposing a poisoned matrix gives the identity', nearMat(transpose(poisoned), I))
  check('a poisoned matrix applies as the identity',
    nearVec(applyMat3(poisoned, vec(1, 2, 3)), vec(1, 2, 3)))
  check('a poisoned vector comes back as the origin, not as NaN',
    nearVec(applyMat3(I, vec(NaN, 2, 3)), vec(0, 0, 0)))
  check('a wrong-length matrix is not trusted either',
    nearMat(transpose([1, 0, 0, 0, 1] as unknown as Mat3), I))
  check('non-finite angles rebuild as the identity',
    nearMat(rotationFromYawPitchRoll(NaN, 0, 0), I) &&
    nearMat(rotationFromYawPitchRoll(0, Infinity, 0), I))
}

check('the identity handed out is a fresh copy each time', identity() !== identity())

console.log(fails === 0 ? '\nAll orientation checks passed.' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
