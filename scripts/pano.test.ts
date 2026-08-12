/**
 * The panorama maths, checked against ground truth.
 *
 * `orientation.ts` and `equirect.ts` are the "stand in one spot and take a
 * dozen photos, then stitch them" path. Nothing imports them yet — there is no
 * capture screen — so without this file they would rot silently. Every check
 * compares against maths worked out independently here rather than against the
 * modules' own helpers, so a shared mistake cannot pass.
 *
 * These were mutation-tested: deliberately breaking multiply, the gimbal-lock
 * branch, the pole shots, the overlap, the frame-border sampling in boundsOf
 * and the latitude sign each make this file fail. One deliberate break does
 * NOT: planning rows from the row centre instead of the band edge still covers
 * the sphere, with about 16% fewer shots, even at 10 degrees of aiming error.
 * The band-edge rule is therefore margin, not necessity — worth knowing before
 * anyone "optimises" the shot count.
 */
import {
  identity, multiply, transpose, applyMat3, deviceToRotation, lookVector,
  rotationToYawPitchRoll, rotationFromYawPitchRoll, type Mat3,
} from '../src/lib/orientation'
import {
  equirectDirection, projectToShot, verticalFovDeg, rotationFromYawPitch,
  suggestTargets, stitchEquirect, type Shot,
} from '../src/lib/equirect'

let pass = 0, fail = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++ } else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`) }
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

// ---------- independent reference maths ----------
function refMul(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0
    for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j]
    o[i * 3 + j] = s
  }
  return o
}
function det3(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
       - m[1] * (m[3] * m[8] - m[5] * m[6])
       + m[2] * (m[3] * m[7] - m[4] * m[6])
}
function isOrthonormal(m: number[], eps = 1e-9): boolean {
  const mt = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
  const p = refMul(m, mt)
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  return p.every((v, i) => Math.abs(v - I[i]) < eps)
}
// Deterministic PRNG so a failure is reproducible.
let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

console.log('pano: orientation')

// 1. multiply against the reference
{
  let worst = 0
  for (let t = 0; t < 200; t++) {
    const a = Array.from({ length: 9 }, () => rnd() * 4 - 2) as Mat3
    const b = Array.from({ length: 9 }, () => rnd() * 4 - 2) as Mat3
    const got = multiply(a, b), want = refMul(a, b)
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]))
  }
  ok('multiply matches reference', worst < 1e-12, `max err ${worst.toExponential(2)}`)
}

// 2. transpose
{
  const m = [1, 2, 3, 4, 5, 6, 7, 8, 9] as Mat3
  ok('transpose', JSON.stringify(transpose(m)) === JSON.stringify([1, 4, 7, 2, 5, 8, 3, 6, 9]))
}

// 3. deviceToRotation always yields a proper rotation
{
  let bad = 0, worstDet = 0
  for (let t = 0; t < 500; t++) {
    const e = { alpha: rnd() * 360, beta: rnd() * 360 - 180, gamma: rnd() * 180 - 90 }
    const screen = [0, 90, 180, 270][Math.floor(rnd() * 4)]
    const m = deviceToRotation(e, screen)
    if (!isOrthonormal(m, 1e-9)) bad++
    worstDet = Math.max(worstDet, Math.abs(det3(m) - 1))
  }
  ok('deviceToRotation orthonormal, det=+1', bad === 0 && worstDet < 1e-9,
     `${bad} non-orthonormal, worst |det-1| ${worstDet.toExponential(2)}`)
}

// 4. yaw/pitch/roll round-trip away from the poles
{
  let worst = 0, worstAt = ''
  for (let t = 0; t < 2000; t++) {
    const yaw = rnd() * 360
    const pitch = rnd() * 150 - 75          // stay clear of gimbal lock
    const roll = rnd() * 360 - 180
    const m = rotationFromYawPitchRoll(yaw, pitch, roll)
    const r = rotationToYawPitchRoll(m)
    const back = rotationFromYawPitchRoll(r.yaw, r.pitch, r.roll)
    // Compare matrices, not angles: the angle triple is not unique.
    let e = 0
    for (let i = 0; i < 9; i++) e = Math.max(e, Math.abs(m[i] - back[i]))
    if (e > worst) { worst = e; worstAt = `yaw ${yaw.toFixed(1)} pitch ${pitch.toFixed(1)} roll ${roll.toFixed(1)}` }
  }
  ok('yaw/pitch/roll round-trip', worst < 1e-9, `max matrix err ${worst.toExponential(2)} at ${worstAt}`)
}

// 5. gimbal lock produces no NaN and still reconstructs the matrix
{
  let nan = 0, worst = 0
  for (const pitch of [90, -90, 89.9999999, -89.9999999]) {
    for (let t = 0; t < 50; t++) {
      const yaw = rnd() * 360, roll = rnd() * 360 - 180
      const m = rotationFromYawPitchRoll(yaw, pitch, roll)
      const r = rotationToYawPitchRoll(m)
      if (!Number.isFinite(r.yaw) || !Number.isFinite(r.pitch) || !Number.isFinite(r.roll)) nan++
      const back = rotationFromYawPitchRoll(r.yaw, r.pitch, r.roll)
      for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(m[i] - back[i]))
    }
  }
  ok('gimbal lock: no NaN', nan === 0, `${nan} NaN results`)

  // The pole branch exists so a camera aimed at the ceiling does not report a
  // wild roll. Reconstruction alone cannot see that: at a pole every yaw/roll
  // split rebuilds the same matrix, so assert the split that was chosen.
  let wildRoll = 0
  for (const pitch of [90, -90]) {
    for (let t = 0; t < 100; t++) {
      const r = rotationToYawPitchRoll(rotationFromYawPitchRoll(rnd() * 360, pitch, rnd() * 360 - 180))
      if (Math.abs(r.roll) > 1e-9) wildRoll++
    }
  }
  ok('gimbal lock: roll is surrendered, not left wild', wildRoll === 0, `${wildRoll}/200 kept a roll`)
  ok('gimbal lock: matrix still reconstructs', worst < 1e-6, `max err ${worst.toExponential(2)}`)
}

// 6. lookVector is unit length
{
  let worst = 0
  for (let t = 0; t < 200; t++) {
    const m = rotationFromYawPitchRoll(rnd() * 360, rnd() * 180 - 90, rnd() * 360 - 180)
    const v = lookVector(m)
    worst = Math.max(worst, Math.abs(Math.hypot(v.x, v.y, v.z) - 1))
  }
  ok('lookVector unit length', worst < 1e-9, `max err ${worst.toExponential(2)}`)
}

// 7. garbage in, identity out (never NaN)
{
  const junk: unknown[] = [null, undefined, NaN, {}, [1, 2, 3], 'x']
  let bad = 0
  for (const j of junk) {
    const m = deviceToRotation(j as never, NaN)
    if (!m.every(Number.isFinite)) bad++
    const v = applyMat3(j as never, j as never)
    if (!Number.isFinite(v.x + v.y + v.z)) bad++
    const r = rotationToYawPitchRoll(j as never)
    if (!Number.isFinite(r.yaw + r.pitch + r.roll)) bad++
  }
  ok('garbage inputs never yield NaN', bad === 0, `${bad} NaN escapes`)
  ok('identity is identity', JSON.stringify(identity()) === JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1]))
}

console.log('pano: equirect')

// 8. equirectDirection: unit length and known anchors
{
  let worst = 0
  for (let t = 0; t < 500; t++) {
    const d = equirectDirection(rnd(), rnd())
    worst = Math.max(worst, Math.abs(Math.hypot(d.x, d.y, d.z) - 1))
  }
  ok('equirectDirection unit length', worst < 1e-12, `max err ${worst.toExponential(2)}`)

  const north = equirectDirection(0.5, 0)
  const south = equirectDirection(0.5, 1)
  const eq = equirectDirection(0.5, 0.5)
  ok('v=0 is straight up', close(north.y, 1, 1e-12))
  ok('v=1 is straight down', close(south.y, -1, 1e-12))
  ok('v=0.5 is on the horizon', close(eq.y, 0, 1e-12))
  // u must sweep a full turn: u and u+1 land on the same ray.
  const a = equirectDirection(0.17, 0.6), b = equirectDirection(1.17, 0.6)
  ok('u wraps at 1', close(a.x, b.x, 1e-12) && close(a.z, b.z, 1e-12))
}

// 9. verticalFovDeg against independently computed ground truth
{
  ok('square frame: vFov == hFov', close(verticalFovDeg(1000, 1000, 60)!, 60, 1e-9))
  // Ground truth: f = (w/2)/tan(h/2); vFov = 2*atan((h/2)/f)
  const w = 1600, h = 1200, hf = 70
  const f = (w / 2) / Math.tan(hf * Math.PI / 360)
  const want = 2 * Math.atan((h / 2) / f) * 180 / Math.PI
  ok('rectilinear vFov matches tangent maths', close(verticalFovDeg(w, h, hf)!, want, 1e-9))
  // And it must NOT be the naive linear scaling.
  const naive = hf * h / w
  ok('vFov is not naive linear scaling', Math.abs(want - naive) > 1,
     `tangent ${want.toFixed(2)} vs linear ${naive.toFixed(2)}`)
  ok('verticalFovDeg rejects nonsense',
     verticalFovDeg(0, 100, 60) === null && verticalFovDeg(100, 100, 0) === null
     && verticalFovDeg(100, 100, 200) === null && verticalFovDeg(NaN, 1, 1) === null)
}

// 10. rotationFromYawPitch is a proper rotation, and points where it says
{
  let bad = 0, worstAim = 0
  for (let t = 0; t < 300; t++) {
    const yaw = rnd() * 360 - 180, pitch = rnd() * 180 - 90
    const R = rotationFromYawPitch(yaw, pitch)
    if (!isOrthonormal(R, 1e-9) || Math.abs(det3(R) - 1) > 1e-9) bad++
    // Row 3 is forward in world coords; it must equal the direction of (yaw,pitch).
    const want = equirectDirection(0.5 + yaw / 360, 0.5 - pitch / 180)
    worstAim = Math.max(worstAim, Math.hypot(R[6] - want.x, R[7] - want.y, R[8] - want.z))
  }
  ok('rotationFromYawPitch is a proper rotation', bad === 0, `${bad} bad matrices`)
  ok('rotationFromYawPitch aims where asked', worstAim < 1e-9, `max err ${worstAim.toExponential(2)}`)
}

// 11. projectToShot round-trip: pixel -> direction -> pixel
{
  const W = 1200, H = 1600, HF = 65
  const R = rotationFromYawPitch(37, 12)
  const shot: Shot = { width: W, height: H, pixels: new Uint8ClampedArray(0), rotation: R, hFovDeg: HF }
  const focal = (W / 2) / Math.tan(HF * Math.PI / 360)
  let worst = 0, missed = 0
  for (let t = 0; t < 2000; t++) {
    const sx = rnd() * W, sy = rnd() * H
    // Unproject with our own maths, independent of the module.
    const cx = (sx - W / 2) / focal, cy = (sy - H / 2) / focal, cz = 1
    // camera -> world is R transposed (R is world -> camera)
    const wx = R[0] * cx + R[3] * cy + R[6] * cz
    const wy = R[1] * cx + R[4] * cy + R[7] * cz
    const wz = R[2] * cx + R[5] * cy + R[8] * cz
    const len = Math.hypot(wx, wy, wz)
    const back = projectToShot({ x: wx / len, y: wy / len, z: wz / len }, shot)
    if (!back) { missed++; continue }
    worst = Math.max(worst, Math.hypot(back.sx - sx, back.sy - sy))
  }
  ok('projectToShot round-trips every in-frame pixel', missed === 0, `${missed} of 2000 dropped`)
  ok('projectToShot round-trip accurate', worst < 1e-6, `max err ${worst.toExponential(2)} px`)

  // Anything behind the camera must be rejected, never wrapped to the front.
  let leaked = 0
  for (let t = 0; t < 500; t++) {
    const d = equirectDirection(rnd(), rnd())
    const fz = R[6] * d.x + R[7] * d.y + R[8] * d.z   // forward component
    if (fz < -0.05 && projectToShot(d, shot)) leaked++
  }
  ok('projectToShot rejects rays behind the camera', leaked === 0, `${leaked} leaked`)
}

// 12. THE REAL TEST: does suggestTargets actually cover the whole sphere?
{
  const W = 1200, H = 1600, HF = 65
  const VF = verticalFovDeg(W, H, HF)!
  const targets = suggestTargets(HF, VF)
  const shots: Shot[] = targets.map(t => ({
    width: W, height: H, pixels: new Uint8ClampedArray(0),
    rotation: rotationFromYawPitch(t.yaw, t.pitch), hFovDeg: HF,
  }))

  // Sample the sphere uniformly by area (not by lat/lon, which over-weights poles).
  let uncovered = 0, worstGapLat = 0
  const N = 20000
  for (let i = 0; i < N; i++) {
    const y = 1 - 2 * (i + 0.5) / N              // uniform in y == uniform in area
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const phi = i * Math.PI * (3 - Math.sqrt(5)) // golden angle
    const d = { x: r * Math.cos(phi), y, z: r * Math.sin(phi) }
    let hit = false
    for (const s of shots) { if (projectToShot(d, s)) { hit = true; break } }
    if (!hit) { uncovered++; worstGapLat = Math.max(worstGapLat, Math.abs(Math.asin(y) * 180 / Math.PI)) }
  }
  const pct = 100 * (1 - uncovered / N)
  console.log(`    ${targets.length} targets for ${HF.toFixed(0)}x${VF.toFixed(1)} deg; sphere coverage ${pct.toFixed(3)}%`)
  ok('suggestTargets covers the whole sphere', uncovered === 0,
     `${uncovered}/${N} directions uncovered (${pct.toFixed(3)}%), worst at |lat| ${worstGapLat.toFixed(1)} deg`)

  // How much margin does the plan really have? Sweep the shots' true FOV down
  // as a fraction of the planned FOV and find where the sphere stops closing.
  // This both proves the metric is sensitive (it must fail somewhere) and says
  // how much slop a shaky hand and a mis-declared lens can eat.
  {
    const gapsAt = (frac: number) => {
      const ss: Shot[] = targets.map(t => ({
        width: W, height: H, pixels: new Uint8ClampedArray(0),
        rotation: rotationFromYawPitch(t.yaw, t.pitch), hFovDeg: HF * frac,
      }))
      let miss = 0
      for (let i = 0; i < 6000; i++) {
        const y = 1 - 2 * (i + 0.5) / 6000
        const r = Math.sqrt(Math.max(0, 1 - y * y))
        const phi = i * Math.PI * (3 - Math.sqrt(5))
        const d = { x: r * Math.cos(phi), y, z: r * Math.sin(phi) }
        if (!ss.some(s => projectToShot(d, s))) miss++
      }
      return miss
    }
    const sweep = [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2].map(f => [f, gapsAt(f)] as const)
    console.log('    FOV margin sweep (fraction -> uncovered of 6000): '
      + sweep.map(([f, m]) => `${f}:${m}`).join('  '))
    const breaks = sweep.find(([, m]) => m > 0)
    ok('coverage metric is sensitive (some FOV leaves gaps)', !!breaks,
       'even a 20% lens covered everything, so the metric is not measuring coverage')
    ok('planner has real margin (80% of declared FOV still covers)',
       sweep.find(([f]) => f === 0.8)![1] === 0)
    if (breaks) console.log(`    coverage first breaks at ${breaks[0]}x the declared FOV`)
  }

  // A wider lens must need fewer shots, a narrower lens more. Sanity on the planner.
  const few = suggestTargets(110, 90).length
  const many = suggestTargets(40, 30).length
  ok('shot count falls as the lens widens', few < targets.length && many > targets.length,
     `110deg -> ${few}, 65deg -> ${targets.length}, 40deg -> ${many}`)
  ok('suggestTargets survives nonsense', suggestTargets(NaN, 10).length === 0 && suggestTargets(60, 45, NaN).length > 0)
}

// 13. THE OTHER REAL TEST: does the stitcher actually fill the canvas?
{
  const W = 160, H = 120, HF = 65                 // small frames keep this quick
  const VF = verticalFovDeg(W, H, HF)!
  const targets = suggestTargets(HF, VF)
  const shots: Shot[] = targets.map((t, i) => {
    const px = new Uint8ClampedArray(W * H * 4)
    // Each shot a distinct flat colour, fully opaque.
    const c = [(i * 53) % 256, (i * 97) % 256, (i * 151) % 256]
    for (let p = 0; p < W * H; p++) {
      px[p * 4] = c[0]; px[p * 4 + 1] = c[1]; px[p * 4 + 2] = c[2]; px[p * 4 + 3] = 255
    }
    return { width: W, height: H, pixels: px, rotation: rotationFromYawPitch(t.yaw, t.pitch), hFovDeg: HF }
  })

  const t0 = Date.now()
  const out = stitchEquirect(shots, { width: 512 })
  const ms = Date.now() - t0
  console.log(`    stitched ${shots.length} frames -> ${out.width}x${out.height} in ${ms} ms; coveredFraction ${out.coveredFraction.toFixed(4)}`)

  ok('stitch derives 2:1 height from width alone', out.width === 512 && out.height === 256)
  ok('stitch covers the whole canvas', out.coveredFraction > 0.999,
     `coveredFraction ${out.coveredFraction.toFixed(4)}`)

  // No pixel may be left transparent or NaN where coverage claims data.
  let holes = 0, badAlpha = 0
  for (let p = 0; p < out.width * out.height; p++) {
    if (out.coverage[p] <= 0) holes++
    else if (out.pixels[p * 4 + 3] !== 255) badAlpha++
  }
  ok('no uncovered output pixels', holes === 0, `${holes} holes`)
  ok('covered pixels are opaque', badAlpha === 0, `${badAlpha} wrong alpha`)

  ok('empty input returns an empty canvas, not a crash',
     stitchEquirect([]).coveredFraction === 0 && stitchEquirect(null as never).coveredFraction === 0)
}

// 14. seam handling: a single shot straddling the +/-180 seam
{
  const W = 320, H = 240, HF = 90
  const px = new Uint8ClampedArray(W * H * 4).fill(200)
  for (let p = 0; p < W * H; p++) px[p * 4 + 3] = 255
  const shot: Shot = { width: W, height: H, pixels: px, rotation: rotationFromYawPitch(180, 0), hFovDeg: HF }
  const out = stitchEquirect([shot], { width: 256 })
  // Must paint BOTH edges of the canvas, not one 90%-wide band across the middle.
  let leftEdge = 0, rightEdge = 0, middle = 0
  for (let y = 0; y < out.height; y++) {
    if (out.coverage[y * out.width + 0] > 0) leftEdge++
    if (out.coverage[y * out.width + out.width - 1] > 0) rightEdge++
    if (out.coverage[y * out.width + (out.width >> 1)] > 0) middle++
  }
  ok('a seam-straddling shot wraps to both edges', leftEdge > 0 && rightEdge > 0,
     `left ${leftEdge}, right ${rightEdge}`)
  ok('a seam-straddling shot does not smear across the far side', middle === 0,
     `${middle} rows painted at the antipode`)
}

if (fail) {
  for (const f of failures) console.error('  FAIL  ' + f)
  console.error(`${fail} pano checks failed`)
  process.exit(1)
}
console.log(`All ${pass} pano checks passed.`)
