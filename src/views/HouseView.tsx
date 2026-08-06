import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls, PointerLockControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { levelMetres } from '../types'
import type { HousePlan, LocationKind, Room, StorageLocation, StockStatus, Wall } from '../types'
import { STATUS_META, STATUS_ORDER, stockStatus } from '../lib/stock'
import { Empty } from '../ui/primitives'
import { ItemRow } from '../ui/ItemRow'
import AddItem from './AddItem'

/**
 * The doll's-house view, in the style of a property portal's 3D floorplan:
 * walls cut off at waist height so you can see into every room from above, a
 * light neutral palette, simple furniture massing for each storage place, and
 * a soft contact shadow grounding the whole thing.
 *
 * Storage places are drawn as actual furniture rather than floating pins — a
 * cabinet looks like a cabinet — with a status bead above anything running
 * low, so the state of the house is legible at a glance.
 */

const CUT_HEIGHT = 1.25 // where the walls are sliced, metres
const FLOOR_TINTS = ['#EDE7DE', '#E7E9EA', '#EAE6DF', '#E4E8E9', '#EFEAE2', '#E6E9EB']

export default function HouseView({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const plan = useStore(s => s.plan)
  const locations = useStore(s => s.locations)
  const items = useStore(s => s.items)
  const settings = useStore(s => s.settings)

  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'doll' | 'walk'>('doll')
  const [cutaway, setCutaway] = useState(true)
  const [lost, setLost] = useState(false)
  const [addTo, setAddTo] = useState<string | null>(null)
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const canWalk = useMemo(() => !('ontouchstart' in window) && window.innerWidth > 720, [])

  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])

  const statusByLoc = useMemo(() => {
    const m = new Map<string, StockStatus>()
    for (const i of items) {
      if (i.archived || !i.locationId) continue
      const s = stockStatus(i, settings)
      const cur = m.get(i.locationId)
      if (!cur || STATUS_ORDER[s] < STATUS_ORDER[cur]) m.set(i.locationId, s)
    }
    return m
  }, [items, settings])

  const countByLoc = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) {
      if (i.archived || !i.locationId) continue
      m.set(i.locationId, (m.get(i.locationId) ?? 0) + 1)
    }
    return m
  }, [items])

  const bounds = useMemo(() => computeBounds(plan, locations), [plan, locations])
  const placed = useMemo(() => locations.filter(l => l.pos), [locations])
  const selectedLoc = selected ? locMap.get(selected) : null
  const selectedItems = useMemo(
    () => items.filter(i => !i.archived && i.locationId === selected),
    [items, selected],
  )

  // In walk mode you are standing inside, so cut walls would be nonsense.
  const wallHeight = mode === 'walk' || !cutaway ? plan.wallHeight : CUT_HEIGHT

  if (plan.walls.length === 0 && plan.rooms.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink-200">House</h1>
        <div className="mt-5">
          <Empty
            icon="⌂"
            title="No house traced yet"
            hint="Upload your 2D floorplan and trace the walls once. The 3D model is generated from that — no modelling required."
            action={<Link to="/plan" className="btn btn-primary">Open floorplan editor</Link>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative" style={{ height: 'calc(100dvh - var(--nav-h) - var(--safe-b) - var(--safe-t))' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 42, near: 0.1, far: 400, position: [bounds.span, bounds.span, bounds.span] }}
        onPointerMissed={() => setSelected(null)}
        onCreated={({ gl, scene }) => {
          glRef.current = gl
          setLost(false)
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
          scene.background = new THREE.Color('#F2F4F6')
          const canvas = gl.domElement
          if (canvas.dataset.lossWired === '1') return
          canvas.dataset.lossWired = '1'
          canvas.addEventListener('webglcontextlost', e => {
            e.preventDefault()
            // R3F reuses the canvas across remounts and disposal force-loses
            // the context, so only complain if the live renderer is still dead.
            setTimeout(() => {
              const live = glRef.current?.getContext()
              if (!live || live.isContextLost()) setLost(true)
            }, 500)
          })
          canvas.addEventListener('webglcontextrestored', () => setLost(false))
        }}
      >
        {/* Studio lighting: a soft sky-to-ground gradient plus one key light.
            That is what gives the clean flat property-portal look. */}
        <hemisphereLight args={['#ffffff', '#ccd1d7', 1.55]} />
        <directionalLight position={[bounds.span * 0.8, bounds.span * 1.4, bounds.span * 0.45]} intensity={2.1} />
        <directionalLight position={[-bounds.span, bounds.span * 0.7, -bounds.span * 0.6]} intensity={0.5} />

        <FitCamera bounds={bounds} wallHeight={wallHeight} mode={mode} />

        {/* Recentred on the origin so orbit, pan and contact shadow all share
            one pivot regardless of where the plan was drawn. */}
        <group position={[-bounds.cx, 0, -bounds.cz]}>
          {plan.rooms.map((r, i) => (
            <RoomFloor key={r.id} room={r} tint={FLOOR_TINTS[i % FLOOR_TINTS.length]} />
          ))}
          {plan.walls.map(w => (
            <WallMesh key={w.id} wall={w} height={wallHeight} cut={wallHeight < plan.wallHeight} />
          ))}

          {placed.map(l => (
            <Furniture
              key={l.id}
              loc={l}
              status={statusByLoc.get(l.id) ?? 'ok'}
              count={countByLoc.get(l.id) ?? 0}
              active={selected === l.id}
              onSelect={() => setSelected(s => (s === l.id ? null : l.id))}
            />
          ))}
        </group>

        <ContactShadows
          position={[0, 0.002, 0]}
          scale={bounds.span * 2.4}
          opacity={0.4}
          blur={2.4}
          far={4}
          resolution={512}
          color="#5b636c"
        />

        {mode === 'doll' ? (
          <OrbitControls
            makeDefault
            target={[0, 0.4, 0]}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI / 2.35}
            minDistance={bounds.span * 0.2}
            /* Generous ceiling: a portrait phone must sit a long way back to
               fit the plan, and a tight maxDistance silently drags the fitted
               camera in and crops the house. */
            maxDistance={bounds.span * 8}
            enablePan
            enableDamping
            dampingFactor={0.075}
            rotateSpeed={0.7}
          />
        ) : (
          <WalkControls bounds={bounds} />
        )}
      </Canvas>

      {/* --- overlay chrome ------------------------------------------------ */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto rounded-xl border border-black/10 bg-white/85 px-3 py-2 shadow-sm backdrop-blur">
          <div className="text-micro font-semibold uppercase tracking-wider text-amber-700">House</div>
          <div className="text-mini text-slate-500">
            {placed.length} marked {placed.length === 1 ? 'place' : 'places'}
          </div>
        </div>
        <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">
          {mode === 'doll' && (
            <button className={lightChip(cutaway)} onClick={() => setCutaway(c => !c)}>
              {cutaway ? 'Cutaway' : 'Full walls'}
            </button>
          )}
          {canWalk && (
            <button className={lightChip(mode === 'walk')} onClick={() => setMode(m => (m === 'walk' ? 'doll' : 'walk'))}>
              {mode === 'walk' ? 'Exit walk' : 'Walk through'}
            </button>
          )}
          <Link to="/plan" className={lightChip(false)}>Edit plan</Link>
        </div>
      </div>

      {lost && (
        <div className="absolute inset-0 grid place-items-center bg-ink-900/92 px-6 text-center">
          <div>
            <p className="text-sm font-medium text-ink-200">3D lost its graphics context</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-400">
              Usually means the phone reclaimed memory while the app was in the background.
            </p>
            <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      )}

      {mode === 'walk' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-mini text-slate-500">
          Click to look · W A S D to move · Shift to sprint · Esc to release
        </div>
      )}

      {selectedLoc && mode === 'doll' && (
        <div className="sheet-up absolute inset-x-0 bottom-0 max-h-[52%] overflow-hidden rounded-t-2xl border-t border-ink-700 bg-ink-900/97 backdrop-blur-lg">
          <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink-200">{selectedLoc.name}</div>
              <div className="text-mini text-ink-500">
                {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'items'}
                {selectedLoc.longTerm && ' · long-term storage'}
              </div>
            </div>
            <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => setAddTo(selectedLoc.id)}>+ Add</button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(null)}>Close</button>
          </header>
          <div className="scroll-thin max-h-[38dvh] overflow-y-auto">
            {selectedItems.length === 0 ? (
              <button
                onClick={() => setAddTo(selectedLoc.id)}
                className="w-full px-4 py-6 text-center text-xs text-brass-400"
              >Nothing in here yet — add the first thing</button>
            ) : (
              selectedItems.map(i => (
                <ItemRow key={i.id} item={i} settings={settings} locMap={locMap} plan={plan} onOpen={onOpenItem} dense />
              ))
            )}
          </div>
        </div>
      )}

      <AddItem
        open={!!addTo}
        presetLocationId={addTo}
        onClose={() => setAddTo(null)}
        onOpenItem={onOpenItem}
      />
    </div>
  )
}

const lightChip = (on: boolean) =>
  `chip shadow-sm ${on
    ? 'border-amber-500/40 bg-amber-400/90 text-amber-950'
    : 'border-black/10 bg-white/85 text-slate-600'}`

// --- scene pieces ----------------------------------------------------------

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number; cx: number; cz: number; span: number }

function computeBounds(plan: HousePlan, locations: StorageLocation[]): Bounds {
  const xs: number[] = []
  const zs: number[] = []
  for (const w of plan.walls) { xs.push(w.a.x, w.b.x); zs.push(w.a.z, w.b.z) }
  for (const r of plan.rooms) for (const pt of r.polygon) { xs.push(pt.x); zs.push(pt.z) }
  for (const l of locations) if (l.pos) { xs.push(l.pos.x); zs.push(l.pos.z) }
  if (!xs.length) return { minX: 0, maxX: 10, minZ: 0, maxZ: 10, cx: 5, cz: 5, span: 10 }
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  return {
    minX, maxX, minZ, maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    span: Math.max(maxX - minX, maxZ - minZ, 4),
  }
}

/**
 * Frame the whole house on first paint.
 *
 * Closed-form fits are unreliable here: the view is a tilted three-quarter,
 * the plan can be any shape, and a portrait phone has a far narrower
 * horizontal field of view than its 42° vertical one. So instead of deriving
 * a distance, project the eight corners of the model's bounding box and pull
 * the camera in or out until they fill the frame. Four passes converge to
 * within a pixel.
 */
const FILL = 0.92 // leave a small margin so labels are not clipped

/**
 * Standard three-quarter viewing angle, ~40° above the horizon. Rotating it
 * per viewport was tried and looked worse: the silhouette goes diagonal and
 * reads as smaller even when it measures larger.
 */
const VIEW_DIR = new THREE.Vector3(0.46, 0.72, 0.62).normalize()

function FitCamera({ bounds, wallHeight, mode }: {
  bounds: Bounds; wallHeight: number; mode: 'doll' | 'walk'
}) {
  const { camera, size, controls } = useThree()
  const done = useRef('')

  useEffect(() => {
    if (mode !== 'doll') { done.current = ''; return }
    const key = `${bounds.cx}:${bounds.cz}:${bounds.span}:${wallHeight}:${size.width}x${size.height}`
    if (done.current === key) return
    done.current = key

    const cam = camera as THREE.PerspectiveCamera
    // Model space is recentred on the origin by the wrapping <group>.
    const half = new THREE.Vector3(
      (bounds.maxX - bounds.minX) / 2 + 0.45,
      0,
      (bounds.maxZ - bounds.minZ) / 2 + 0.45,
    )
    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      corners.push(new THREE.Vector3(sx * half.x, sy * (wallHeight + 0.6), sz * half.z))
    }

    const dir = VIEW_DIR
    const target = new THREE.Vector3(0, 0.4, 0)
    let dist = Math.max(half.x, half.z) * 3
    const v = new THREE.Vector3()

    for (let pass = 0; pass < 4; pass++) {
      camera.position.copy(target).addScaledVector(dir, dist)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      cam.updateProjectionMatrix()

      let worst = 0
      for (const c of corners) {
        v.copy(c).project(camera)
        worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y))
      }
      if (worst <= 0) break
      dist *= worst / FILL
    }

    camera.position.copy(target).addScaledVector(dir, dist)
    camera.lookAt(target)
    cam.updateProjectionMatrix()
    ;(controls as unknown as { target?: THREE.Vector3; update?: () => void } | null)?.update?.()
  }, [bounds, wallHeight, camera, size, mode, controls])

  return null
}

function RoomFloor({ room, tint }: { room: Room; tint: string }) {
  /**
   * Floors are extruded rather than flat planes, and there is deliberately no
   * bounding-box ground slab: a plan is rarely a rectangle, and a rectangular
   * slab under an L-shaped flat reads as one enormous empty room. Building the
   * base out of the rooms themselves gives the true footprint for free.
   */
  const { geo, slab } = useMemo(() => {
    const shape = new THREE.Shape()
    room.polygon.forEach((pt, i) => (i === 0 ? shape.moveTo(pt.x, pt.z) : shape.lineTo(pt.x, pt.z)))
    shape.closePath()

    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(Math.PI / 2) // authored in XY, laid flat on XZ

    const e = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false })
    e.rotateX(Math.PI / 2)
    return { geo: g, slab: e }
  }, [room.polygon])

  const centroid = useMemo(() => {
    const n = room.polygon.length || 1
    return [
      room.polygon.reduce((a, p) => a + p.x, 0) / n,
      room.polygon.reduce((a, p) => a + p.z, 0) / n,
    ] as const
  }, [room.polygon])

  return (
    <group>
      <mesh geometry={slab} position={[0, 0.008, 0]}>
        <meshStandardMaterial color="#CDD3D9" roughness={1} />
      </mesh>
      <mesh geometry={geo} position={[0, 0.012, 0]}>
        <meshStandardMaterial color={room.color ?? tint} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <Text
        position={[centroid[0], 0.05, centroid[1]]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.3}
        letterSpacing={0.12}
        color="#8A9099"
        anchorX="center"
        anchorY="middle"
      >
        {room.name.toUpperCase()}
      </Text>
    </group>
  )
}

function WallMesh({ wall, height, cut }: { wall: Wall; height: number; cut: boolean }) {
  const { pos, rot, len } = useMemo(() => {
    const dx = wall.b.x - wall.a.x
    const dz = wall.b.z - wall.a.z
    return {
      len: Math.hypot(dx, dz),
      pos: [(wall.a.x + wall.b.x) / 2, height / 2, (wall.a.z + wall.b.z) / 2] as [number, number, number],
      rot: [0, -Math.atan2(dz, dx), 0] as [number, number, number],
    }
  }, [wall, height])

  const thickness = wall.thickness || 0.12
  if (len < 0.02) return null

  return (
    <group position={pos} rotation={rot}>
      <mesh>
        <boxGeometry args={[len, height, thickness]} />
        <meshStandardMaterial color="#FBFAF8" roughness={0.92} />
      </mesh>
      {/* The sliced edge, drawn slightly darker. This one detail is what makes
          a cutaway read as cut rather than as a suspiciously short wall. */}
      {cut && (
        <mesh position={[0, height / 2 + 0.005, 0]}>
          <boxGeometry args={[len + 0.004, 0.02, thickness + 0.004]} />
          <meshStandardMaterial color="#B9C0C7" roughness={1} />
        </mesh>
      )}
    </group>
  )
}

/** Rough real-world massing per kind of storage: [width, height, depth]. */
const MASSING: Record<LocationKind, [number, number, number]> = {
  cabinet:  [0.9, 1.15, 0.45],
  wardrobe: [1.4, 1.15, 0.6],
  fridge:   [0.75, 1.15, 0.7],
  freezer:  [0.75, 1.0, 0.7],
  drawer:   [1.1, 0.5, 0.45],
  shelf:    [0.9, 0.9, 0.32],
  rack:     [1.2, 1.15, 0.4],
  store:    [1.0, 1.0, 0.6],
  box:      [0.5, 0.4, 0.4],
  other:    [0.6, 0.7, 0.4],
}

const KIND_TINT: Record<LocationKind, string> = {
  cabinet: '#C9AD88', wardrobe: '#BFA079', fridge: '#D6DADE', freezer: '#CFD6DC',
  drawer: '#C2A382', shelf: '#CDB393', rack: '#AEB5BC', store: '#C7CBD0',
  box: '#D3C3A8', other: '#C4C9CE',
}

function Furniture({ loc, status, count, active, onSelect }: {
  loc: StorageLocation
  status: StockStatus
  count: number
  active: boolean
  onSelect: () => void
}) {
  const beadRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const [w, hFull, d] = MASSING[loc.kind] ?? MASSING.other
  // Mounted units hang off the wall; a wall cupboard at eye level should not
  // be drawn sitting on the floor, or upper and lower look identical.
  const mount = levelMetres(loc.level)
  const h = mount > 0 ? Math.min(hFull, 0.75) : hFull
  const alert = status !== 'ok'
  const colour = STATUS_META[status].hex
  const base = KIND_TINT[loc.kind] ?? KIND_TINT.other

  useFrame(({ clock }) => {
    if (!beadRef.current || !alert) return
    beadRef.current.position.y = mount + h + 0.3 + Math.sin(clock.getElapsedTime() * 2.2) * 0.035
  })

  return (
    <group position={[loc.pos!.x, 0, loc.pos!.z]}>
      <mesh
        position={[0, mount + h / 2, 0]}
        onClick={e => { e.stopPropagation(); onSelect() }}
        onPointerOver={e => { e.stopPropagation(); setHovered(true) }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={active || hovered ? '#F0C27B' : base}
          roughness={0.78}
          metalness={0.02}
        />
      </mesh>

      {/* Floor-standing units get a plinth; mounted ones get a bracket line
          down to the floor so you can still see where they are in plan. */}
      {mount > 0 ? (
        <mesh position={[0, mount / 2, 0]}>
          <boxGeometry args={[0.02, mount, 0.02]} />
          <meshStandardMaterial color="#B4BAC0" roughness={1} />
        </mesh>
      ) : (
        <mesh position={[0, 0.006, 0]}>
          <boxGeometry args={[w + 0.05, 0.012, d + 0.05]} />
          <meshStandardMaterial color="#A8AEB4" roughness={1} />
        </mesh>
      )}

      {alert && (
        <mesh ref={beadRef} position={[0, mount + h + 0.3, 0]}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.7} roughness={0.35} />
        </mesh>
      )}

      <Html
        position={[0, mount + h + (alert ? 0.55 : 0.28), 0]}
        center
        distanceFactor={13}
        style={{ pointerEvents: 'none', transition: 'opacity .15s', opacity: active || hovered || alert ? 1 : 0.72 }}
      >
        <div
          className="whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold shadow-sm"
          style={{
            borderColor: alert ? `${colour}66` : 'rgba(0,0,0,0.10)',
            background: 'rgba(255,255,255,0.94)',
            color: alert ? colour : '#4A5158',
          }}
        >
          {loc.name}{count > 0 ? ` · ${count}` : ''}
        </div>
      </Html>
    </group>
  )
}

/** First-person walkabout. Desktop only — pointer lock does not exist on touch. */
function WalkControls({ bounds }: { bounds: Bounds }) {
  const { camera } = useThree()
  const keys = useRef<Record<string, boolean>>({})
  const dir = useRef(new THREE.Vector3())
  const fwd = useRef(new THREE.Vector3())
  const side = useRef(new THREE.Vector3())

  useEffect(() => {
    camera.position.set(0, 1.65, (bounds.maxZ - bounds.cz) + 1.5)
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true }
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [camera, bounds])

  useFrame((_, delta) => {
    const k = keys.current
    const speed = (k['ShiftLeft'] || k['ShiftRight'] ? 5.2 : 2.4) * delta
    const f = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0)
    const s = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0)
    if (!f && !s) return

    camera.getWorldDirection(fwd.current)
    fwd.current.y = 0
    fwd.current.normalize()
    side.current.crossVectors(fwd.current, camera.up).normalize()

    dir.current.set(0, 0, 0)
      .addScaledVector(fwd.current, f)
      .addScaledVector(side.current, s)
      .normalize()
      .multiplyScalar(speed)

    camera.position.add(dir.current)
    camera.position.y = 1.65 // eye height; no crouching, no flying
  })

  return <PointerLockControls makeDefault />
}
