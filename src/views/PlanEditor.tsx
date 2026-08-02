import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { uploadPhoto, imageSize } from '../lib/images'
import type { Pt, Room, Wall } from '../types'
import { Field, Sheet } from '../ui/primitives'

type Tool = 'select' | 'scale' | 'wall' | 'room' | 'place'

const SNAP_PX = 14
const uid = () => crypto.randomUUID().slice(0, 8)

/**
 * Trace the 2D floorplan once; the 3D house is generated from it.
 *
 * Everything is stored in metres so the 3D view needs no knowledge of the
 * source image — you can replace the plan later without invalidating walls,
 * rooms or storage markers.
 */
export default function PlanEditor() {
  const plan = useStore(s => s.plan)
  const savePlan = useStore(s => s.savePlan)
  const locations = useStore(s => s.locations)
  const saveLocation = useStore(s => s.saveLocation)

  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [busy, setBusy] = useState(false)
  const [renderW, setRenderW] = useState(0)

  // in-progress geometry, in image pixels
  const [chain, setChain] = useState<[number, number][]>([])
  const [scalePts, setScalePts] = useState<[number, number][]>([])
  const [scaleAsk, setScaleAsk] = useState(false)
  const [scaleMetres, setScaleMetres] = useState('3')
  const [roomAsk, setRoomAsk] = useState<[number, number][] | null>(null)
  const [roomName, setRoomName] = useState('')
  const [placeFor, setPlaceFor] = useState<string>('')
  const [hint, setHint] = useState<string | null>(null)

  const mpp = plan.metresPerPixel ?? null
  const imgW = plan.imageW ?? 0
  const imgH = plan.imageH ?? 0
  const scale = imgW ? renderW / imgW : 1 // screen px per image px

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRenderW(el.clientWidth))
    ro.observe(el)
    setRenderW(el.clientWidth)
    return () => ro.disconnect()
  }, [plan.planImageUrl])

  // metres <-> image pixels
  const toM = (px: number) => (mpp ? px * mpp : px)
  const toPx = (m: number) => (mpp ? m / mpp : m)
  // image pixels <-> screen
  const sx = (px: number) => px * scale
  const unsx = (screen: number) => screen / scale

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const url = await uploadPhoto(files[0], 'plans', 'floorplan')
      const { w, h } = await imageSize(url)
      await savePlan({ planImageUrl: url, imageW: w, imageH: h })
      setHint('Now set the scale: pick the Scale tool and click two points a known distance apart.')
    } finally { setBusy(false) }
  }

  /** Snap to any existing wall endpoint so rooms actually close up. */
  const snap = (p: [number, number]): [number, number] => {
    const tol = SNAP_PX / scale
    let best: [number, number] | null = null
    let bestD = tol
    const cands: [number, number][] = []
    for (const w of plan.walls) { cands.push([toPx(w.a.x), toPx(w.a.z)], [toPx(w.b.x), toPx(w.b.z)]) }
    for (const c of chain) cands.push(c)
    for (const c of cands) {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1])
      if (d < bestD) { bestD = d; best = c }
    }
    return best ?? p
  }

  const onCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const raw: [number, number] = [unsx(e.clientX - rect.left), unsx(e.clientY - rect.top)]
    const p = tool === 'scale' ? raw : snap(raw)

    if (tool === 'scale') {
      const next = [...scalePts, p]
      if (next.length === 2) { setScalePts(next); setScaleAsk(true) }
      else setScalePts(next)
      return
    }

    if (tool === 'wall') {
      if (chain.length === 0) { setChain([p]); return }
      const prev = chain[chain.length - 1]
      const wall: Wall = {
        id: uid(),
        a: { x: toM(prev[0]), z: toM(prev[1]) },
        b: { x: toM(p[0]), z: toM(p[1]) },
        height: plan.wallHeight,
        thickness: 0.12,
      }
      void savePlan({ walls: [...plan.walls, wall] })
      setChain([...chain, p])
      return
    }

    if (tool === 'room') {
      const pts = [...chain, p]
      // Closing click: back on the first vertex.
      if (chain.length >= 3 && Math.hypot(chain[0][0] - p[0], chain[0][1] - p[1]) < SNAP_PX / scale) {
        setRoomAsk(chain)
        setChain([])
        return
      }
      setChain(pts)
      return
    }

    if (tool === 'place') {
      if (!placeFor) { setHint('Pick which place you are marking from the dropdown first.'); return }
      void saveLocation({ id: placeFor, pos: { x: toM(p[0]), y: 1.1, z: toM(p[1]) } })
      setHint('Marker dropped. Pick the next place, or switch to Select.')
      setPlaceFor('')
    }
  }

  const endChain = () => {
    if (tool === 'room' && chain.length >= 3) { setRoomAsk(chain); setChain([]); return }
    setChain([])
  }

  const unplaced = useMemo(() => locations.filter(l => !l.pos), [locations])
  const placed = useMemo(() => locations.filter(l => l.pos), [locations])

  return (
    <div className="mx-auto max-w-4xl px-4 py-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-ink-200">Floorplan</h1>
        <Link to="/house" className="text-[0.7rem] font-semibold text-brass-400 hover:text-brass-300">See it in 3D →</Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Upload your 2D plan, set the scale once, then trace the walls. Everything you draw becomes the 3D house.
      </p>

      {!plan.planImageUrl ? (
        <div className="panel mt-5 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="text-3xl opacity-60">🗺</div>
          <div className="text-sm font-semibold text-ink-200">No plan uploaded</div>
          <p className="max-w-sm text-xs leading-relaxed text-ink-400">
            A photo or PDF export of your floorplan works. Straight-on and reasonably square is best —
            a phone photo of a printed plan is fine.
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload floorplan'}
          </button>
        </div>
      ) : (
        <>
          <div className="scroll-thin mt-4 flex gap-1.5 overflow-x-auto pb-1">
            {([
              ['select', 'Select'], ['scale', mpp ? 'Re-scale' : 'Set scale'],
              ['wall', 'Walls'], ['room', 'Rooms'], ['place', 'Markers'],
            ] as [Tool, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setTool(k); setChain([]); setScalePts([]); setHint(null) }}
                disabled={k !== 'scale' && k !== 'select' && !mpp}
                className={`chip shrink-0 disabled:opacity-40 ${
                  tool === k ? 'border-brass-500/50 bg-brass-400/12 text-brass-300' : 'border-ink-600 bg-ink-800 text-ink-400'
                }`}
              >{label}</button>
            ))}
            {chain.length > 0 && (
              <button className="chip shrink-0 border-ink-600 bg-ink-800 text-ink-300" onClick={endChain}>
                {tool === 'room' ? 'Close room' : 'End line'}
              </button>
            )}
            <button className="chip shrink-0 border-ink-600 bg-ink-800 text-ink-400" onClick={() => fileRef.current?.click()}>
              Replace plan
            </button>
          </div>

          <div className="mt-1 text-[0.68rem] leading-relaxed text-ink-500">
            {hint ?? TOOL_HELP[tool](mpp)}
          </div>

          <div ref={wrapRef} className="panel mt-3 overflow-hidden p-0">
            <div className="relative" style={{ aspectRatio: imgW && imgH ? `${imgW} / ${imgH}` : '4 / 3' }}>
              <img src={plan.planImageUrl} alt="Floorplan" className="absolute inset-0 size-full object-contain opacity-55" />
              <svg
                className="absolute inset-0 size-full touch-none"
                onClick={onCanvasClick}
                onDoubleClick={endChain}
                style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
              >
                {/* rooms */}
                {plan.rooms.map(r => (
                  <polygon
                    key={r.id}
                    points={r.polygon.map(pt => `${sx(toPx(pt.x))},${sx(toPx(pt.z))}`).join(' ')}
                    fill={r.color ?? '#E8A33D'}
                    fillOpacity={0.1}
                    stroke={r.color ?? '#E8A33D'}
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                  />
                ))}
                {/* walls */}
                {plan.walls.map(w => (
                  <line
                    key={w.id}
                    x1={sx(toPx(w.a.x))} y1={sx(toPx(w.a.z))}
                    x2={sx(toPx(w.b.x))} y2={sx(toPx(w.b.z))}
                    stroke="#C6CED4" strokeWidth={3} strokeLinecap="round"
                    onClick={e => {
                      if (tool !== 'select') return
                      e.stopPropagation()
                      void savePlan({ walls: plan.walls.filter(x => x.id !== w.id) })
                    }}
                    style={{ cursor: tool === 'select' ? 'pointer' : 'crosshair' }}
                  />
                ))}
                {/* in-progress chain */}
                {chain.length > 0 && (
                  <polyline
                    points={chain.map(([x, y]) => `${sx(x)},${sx(y)}`).join(' ')}
                    fill="none" stroke="#E8A33D" strokeWidth={2} strokeDasharray="5 4"
                  />
                )}
                {chain.map(([x, y], i) => (
                  <circle key={i} cx={sx(x)} cy={sx(y)} r={4} fill="#E8A33D" />
                ))}
                {/* scale points */}
                {scalePts.map(([x, y], i) => (
                  <circle key={i} cx={sx(x)} cy={sx(y)} r={5} fill="#58A6FF" />
                ))}
                {scalePts.length === 2 && (
                  <line
                    x1={sx(scalePts[0][0])} y1={sx(scalePts[0][1])}
                    x2={sx(scalePts[1][0])} y2={sx(scalePts[1][1])}
                    stroke="#58A6FF" strokeWidth={2}
                  />
                )}
                {/* storage markers */}
                {placed.map(l => (
                  <g key={l.id} onClick={e => {
                    if (tool !== 'select') return
                    e.stopPropagation()
                    void saveLocation({ id: l.id, pos: null })
                  }}>
                    <circle cx={sx(toPx(l.pos!.x))} cy={sx(toPx(l.pos!.z))} r={7} fill="#E8A33D" fillOpacity={0.85} />
                    <text
                      x={sx(toPx(l.pos!.x)) + 11}
                      y={sx(toPx(l.pos!.z)) + 4}
                      fontSize={11}
                      fill="#C6CED4"
                    >{l.name}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          {tool === 'place' && (
            <div className="panel mt-3 px-3 py-3">
              <Field label="Which place are you marking?">
                <select value={placeFor} onChange={e => setPlaceFor(e.target.value)}>
                  <option value="">Choose a place…</option>
                  {unplaced.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  {placed.length > 0 && <option disabled>— already placed —</option>}
                  {placed.map(l => <option key={l.id} value={l.id}>{l.name} (move)</option>)}
                </select>
              </Field>
              {unplaced.length === 0 && placed.length === 0 && (
                <p className="mt-2 text-[0.68rem] text-ink-500">
                  Add cupboards under <Link to="/places" className="text-brass-400">Places</Link> first, then drop their markers here.
                </p>
              )}
            </div>
          )}

          <div className="panel mt-3 px-3 py-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Wall height" hint="metres">
                <input
                  type="number" step="0.1"
                  value={plan.wallHeight}
                  onChange={e => savePlan({ wallHeight: Number(e.target.value) })}
                />
              </Field>
              <Field label="Scale" hint="metres per pixel">
                <input type="text" readOnly value={mpp ? mpp.toFixed(5) : 'not set'} />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem] text-ink-500">
              <span>{plan.walls.length} walls</span>
              <span>·</span>
              <span>{plan.rooms.length} rooms</span>
              <span>·</span>
              <span>{placed.length} markers placed</span>
              {plan.walls.length > 0 && (
                <button className="ml-auto text-ink-400 hover:text-rose-300" onClick={() => savePlan({ walls: [] })}>
                  Clear walls
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files)} />

      {/* scale prompt */}
      <Sheet
        open={scaleAsk}
        onClose={() => { setScaleAsk(false); setScalePts([]) }}
        title="How long is that line?"
        footer={
          <button
            className="btn btn-primary w-full"
            onClick={async () => {
              const m = Number(scaleMetres)
              const px = Math.hypot(scalePts[1][0] - scalePts[0][0], scalePts[1][1] - scalePts[0][1])
              if (m > 0 && px > 0) await savePlan({ metresPerPixel: m / px })
              setScaleAsk(false); setScalePts([]); setTool('wall')
              setHint('Scale set. Now trace the walls — click corner to corner, double-click to end a run.')
            }}
          >Set scale</button>
        }
      >
        <Field label="Real-world distance" hint="metres">
          <input type="number" step="0.1" autoFocus value={scaleMetres} onChange={e => setScaleMetres(e.target.value)} />
        </Field>
        <p className="mt-2 text-[0.68rem] leading-relaxed text-ink-500">
          Use something you can measure confidently — a door is usually 0.9 m, a standard HDB room wall is often
          printed on the plan. Everything else scales from this one number.
        </p>
      </Sheet>

      {/* room name prompt */}
      <Sheet
        open={!!roomAsk}
        onClose={() => setRoomAsk(null)}
        title="Name this room"
        footer={
          <button
            className="btn btn-primary w-full"
            disabled={!roomName.trim()}
            onClick={async () => {
              if (!roomAsk) return
              const room: Room = {
                id: uid(),
                name: roomName.trim(),
                polygon: roomAsk.map(([x, y]) => ({ x: toM(x), z: toM(y) }) as Pt),
              }
              await savePlan({ rooms: [...plan.rooms, room] })
              setRoomAsk(null); setRoomName('')
            }}
          >Add room</button>
        }
      >
        <Field label="Room name">
          <input type="text" autoFocus placeholder="Kitchen" value={roomName} onChange={e => setRoomName(e.target.value)} />
        </Field>
      </Sheet>

      {plan.rooms.length > 0 && (
        <div className="panel mt-3 overflow-hidden">
          <header className="border-b border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Rooms</header>
          <ul>
            {plan.rooms.map(r => (
              <li key={r.id} className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-2 text-sm last:border-0">
                <span className="flex-1 text-ink-200">{r.name}</span>
                <button
                  className="text-ink-500 hover:text-rose-300"
                  onClick={() => savePlan({ rooms: plan.rooms.filter(x => x.id !== r.id) })}
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const TOOL_HELP: Record<Tool, (mpp: number | null) => string> = {
  select: () => 'Tap a wall or a marker to remove it.',
  scale: () => 'Click two points a known distance apart, then type the distance.',
  wall: mpp => mpp ? 'Click corner to corner. Each click adds a wall to the run; double-click to finish.' : 'Set the scale first.',
  room: mpp => mpp ? 'Click around the room, then click the first point again to close it.' : 'Set the scale first.',
  place: mpp => mpp ? 'Choose a place below, then click where it sits on the plan.' : 'Set the scale first.',
}
