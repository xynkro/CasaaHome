import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { uploadPhoto, imageSize } from '../lib/images'
import type { Pt, Room, Wall } from '../types'
import { Field, Sheet } from '../ui/primitives'

type Tool = 'select' | 'scale' | 'wall' | 'rect' | 'room' | 'marker'

const SNAP_PX = 16          // endpoint snap radius, screen px
const AXIS_SNAP_DEG = 7     // straighten near-orthogonal walls
const SAVE_DEBOUNCE = 450
const uid = () => crypto.randomUUID().slice(0, 8)

type P = [number, number]   // image pixels

/**
 * Trace the 2D floorplan; the 3D house is generated from it.
 *
 * Editing is local-first. Every click used to write to Firestore and wait for
 * the snapshot to come back, so two quick clicks raced and the second one
 * overwrote the first — walls vanished as you drew them. Now the on-screen
 * geometry is the source of truth while you work and is flushed on a debounce,
 * with an explicit saved/saving indicator so you can see it land.
 *
 * Everything is stored in metres, so replacing the backdrop later does not
 * invalidate any of it.
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
  const [localPlan, setLocalPlan] = useState<string | null>(null)

  // --- local-first geometry ------------------------------------------------
  const [draftWalls, setDraftWalls] = useState<Wall[] | null>(null)
  const [draftRooms, setDraftRooms] = useState<Room[] | null>(null)
  const walls = draftWalls ?? plan.walls
  const rooms = draftRooms ?? plan.rooms

  const [history, setHistory] = useState<{ walls: Wall[]; rooms: Room[] }[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async (w: Wall[], r: Room[]) => {
    setSaveState('saving')
    await savePlan({ walls: w, rooms: r })
    setDraftWalls(null); setDraftRooms(null)
    setSaveState('saved')
    setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600)
  }, [savePlan])

  const edit = useCallback((next: { walls?: Wall[]; rooms?: Room[] }) => {
    const w = next.walls ?? walls
    const r = next.rooms ?? rooms
    setHistory(h => [...h.slice(-29), { walls, rooms }])
    setDraftWalls(w); setDraftRooms(r)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(w, r), SAVE_DEBOUNCE)
  }, [walls, rooms, flush])

  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(h => h.slice(0, -1))
    setDraftWalls(prev.walls); setDraftRooms(prev.rooms)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(prev.walls, prev.rooms), SAVE_DEBOUNCE)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // --- in-progress drawing -------------------------------------------------
  const [chain, setChain] = useState<P[]>([])
  const [cursor, setCursor] = useState<P | null>(null)
  const [rectStart, setRectStart] = useState<P | null>(null)
  const [scalePts, setScalePts] = useState<P[]>([])
  const [scaleAsk, setScaleAsk] = useState(false)
  const [scaleMetres, setScaleMetres] = useState('3')
  const [roomAsk, setRoomAsk] = useState<P[] | null>(null)
  const [roomName, setRoomName] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [markerFor, setMarkerFor] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  const bgUrl = plan.planImageUrl ?? plan.planImageData ?? localPlan
  const mpp = plan.metresPerPixel ?? null
  const imgW = plan.imageW ?? 0
  const imgH = plan.imageH ?? 0
  const scale = imgW ? renderW / imgW : 1
  const ready = !!bgUrl || !!mpp

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRenderW(el.clientWidth))
    ro.observe(el); setRenderW(el.clientWidth)
    return () => ro.disconnect()
  }, [ready])

  const toM = (px: number) => (mpp ? px * mpp : px)
  const toPx = (m: number) => (mpp ? m / mpp : m)
  const sx = (px: number) => px * scale
  const unsx = (screen: number) => screen / scale

  // --- snapping ------------------------------------------------------------
  const endpoints = useMemo<P[]>(() => {
    const out: P[] = []
    for (const w of walls) out.push([toPx(w.a.x), toPx(w.a.z)], [toPx(w.b.x), toPx(w.b.z)])
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls, mpp])

  const snapPoint = (p: P): P => {
    const tol = SNAP_PX / scale
    let best: P | null = null; let bd = tol
    for (const c of [...endpoints, ...chain]) {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1])
      if (d < bd) { bd = d; best = c }
    }
    return best ?? p
  }

  /** Straighten a segment that is nearly horizontal or vertical. */
  const axisSnap = (from: P, to: P): P => {
    const dx = to[0] - from[0], dy = to[1] - from[1]
    if (!dx && !dy) return to
    const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI)
    if (ang < AXIS_SNAP_DEG || ang > 180 - AXIS_SNAP_DEG) return [to[0], from[1]]
    if (Math.abs(ang - 90) < AXIS_SNAP_DEG) return [from[0], to[1]]
    return to
  }

  const resolve = (raw: P, from?: P): P => {
    const snapped = snapPoint(raw)
    if (snapped !== raw) return snapped          // an existing endpoint wins
    return from ? axisSnap(from, raw) : raw
  }

  const mkWall = (a: P, b: P): Wall => ({
    id: uid(),
    a: { x: toM(a[0]), z: toM(a[1]) },
    b: { x: toM(b[0]), z: toM(b[1]) },
    height: plan.wallHeight, thickness: 0.12,
  })

  const lengthM = (a: P, b: P) => Math.hypot(b[0] - a[0], b[1] - a[1]) * (mpp ?? 0)

  // --- pointer -------------------------------------------------------------
  const pointAt = (e: React.PointerEvent<SVGSVGElement>): P => {
    const r = e.currentTarget.getBoundingClientRect()
    return [unsx(e.clientX - r.left), unsx(e.clientY - r.top)]
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'select') return
    const raw = pointAt(e)
    const from = chain[chain.length - 1] ?? rectStart ?? undefined
    setCursor(resolve(raw, from))
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'select') { setSelected(null); return }
    const raw = pointAt(e)
    const from = chain[chain.length - 1] ?? rectStart ?? undefined
    const p = resolve(raw, from)

    if (tool === 'scale') {
      const next = [...scalePts, p]
      setScalePts(next)
      if (next.length === 2) setScaleAsk(true)
      return
    }

    if (tool === 'wall') {
      if (!chain.length) { setChain([p]); return }
      const prev = chain[chain.length - 1]
      if (lengthM(prev, p) < 0.05) return
      edit({ walls: [...walls, mkWall(prev, p)] })
      setChain([...chain, p])
      return
    }

    if (tool === 'rect') {
      if (!rectStart) { setRectStart(p); return }
      const [x0, y0] = rectStart, [x1, y1] = p
      if (Math.abs(x1 - x0) < 2 || Math.abs(y1 - y0) < 2) { setRectStart(null); return }
      const c: P[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
      edit({ walls: [...walls, ...c.map((pt, i) => mkWall(pt, c[(i + 1) % 4]))] })
      setRectStart(null)
      setRoomAsk(c)
      return
    }

    if (tool === 'room') {
      if (chain.length >= 3 && Math.hypot(chain[0][0] - p[0], chain[0][1] - p[1]) < SNAP_PX / scale) {
        setRoomAsk(chain); setChain([]); return
      }
      setChain([...chain, p]); return
    }

    if (tool === 'marker') {
      if (!markerFor) { setHint('Choose which place you are marking first.'); return }
      void saveLocation({ id: markerFor, pos: { x: toM(p[0]), y: 1.1, z: toM(p[1]) } })
      setHint('Marker dropped.'); setMarkerFor('')
    }
  }

  const endChain = () => {
    if (tool === 'room' && chain.length >= 3) { setRoomAsk(chain); setChain([]); return }
    setChain([]); setRectStart(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endChain()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        edit({ walls: walls.filter(w => w.id !== selected) }); setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- plan image ----------------------------------------------------------
  const upload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    try {
      let url: string; let cloud = true
      try { url = await uploadPhoto(file, 'plans', 'floorplan') }
      catch { url = URL.createObjectURL(file); cloud = false }
      const { w, h } = await imageSize(url)
      if (cloud) await savePlan({ planImageUrl: url, planImageData: null, imageW: w, imageH: h })
      else { setLocalPlan(url); await savePlan({ imageW: w, imageH: h }) }
      setHint(cloud ? 'Set the scale next.' : 'Loaded locally for this session — tracing still saves.')
    } finally { setBusy(false) }
  }

  const startBlank = async () => {
    await savePlan({ metresPerPixel: 0.02, imageW: 800, imageH: 800 })
    setTool('rect')
    setHint('Blank grid. Drag out a room box, or switch to Walls for one at a time.')
  }

  const unplaced = useMemo(() => locations.filter(l => !l.pos), [locations])
  const placed = useMemo(() => locations.filter(l => l.pos), [locations])
  const selectedWall = walls.find(w => w.id === selected) ?? null

  // --- preview geometry ----------------------------------------------------
  const previewFrom = chain[chain.length - 1] ?? null
  const rectPreview = rectStart && cursor
    ? { x: Math.min(rectStart[0], cursor[0]), y: Math.min(rectStart[1], cursor[1]),
        w: Math.abs(cursor[0] - rectStart[0]), h: Math.abs(cursor[1] - rectStart[1]) }
    : null

  const TOOLS: [Tool, string][] = [
    ['select', 'Select'], ['scale', mpp ? 'Re-scale' : 'Set scale'],
    ['rect', 'Room box'], ['wall', 'Walls'], ['room', 'Outline'], ['marker', 'Markers'],
  ]

  return (
    <div className="mx-auto max-w-4xl px-4 py-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-ink-200">Floorplan</h1>
        <Link to="/house" className="text-[0.7rem] font-semibold text-brass-400 hover:text-brass-300">See it in 3D →</Link>
      </div>

      {!ready ? (
        <div className="panel mt-5 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="text-3xl opacity-60">🗺</div>
          <div className="text-sm font-semibold text-ink-200">No plan yet</div>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Loading…' : 'Upload floorplan'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={startBlank}>Trace without an image</button>
          </div>
        </div>
      ) : (
        <>
          <div className="scroll-thin mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {TOOLS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setTool(k); setChain([]); setRectStart(null); setScalePts([]); setSelected(null); setHint(null) }}
                disabled={k !== 'scale' && k !== 'select' && !mpp}
                className={`chip shrink-0 disabled:opacity-40 ${
                  tool === k ? 'border-brass-500/50 bg-brass-400/12 text-brass-300' : 'border-ink-600 bg-ink-800 text-ink-400'}`}
              >{label}</button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={undo} disabled={!history.length}>↶ Undo</button>
            {(chain.length > 0 || rectStart) && (
              <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={endChain}>
                {tool === 'room' ? 'Close outline' : 'Finish (Esc)'}
              </button>
            )}
            {selectedWall && (
              <button
                className="btn btn-danger px-2.5 py-1 text-xs"
                onClick={() => { edit({ walls: walls.filter(w => w.id !== selectedWall.id) }); setSelected(null) }}
              >Delete wall</button>
            )}
            <span className="tnum ml-auto text-[0.68rem] text-ink-500">
              {walls.length} walls · {rooms.length} rooms
              {saveState === 'saving' && <span className="ml-2 text-brass-400">saving…</span>}
              {saveState === 'saved' && <span className="ml-2 text-emerald-400">saved ✓</span>}
            </span>
          </div>

          <div className="mt-1 min-h-[1.1rem] text-[0.68rem] leading-relaxed text-ink-500">
            {hint ?? HELP[tool]}
          </div>

          <div ref={wrapRef} className="panel mt-2 overflow-hidden p-0">
            <div className="relative select-none" style={{ aspectRatio: imgW && imgH ? `${imgW} / ${imgH}` : '1 / 1' }}>
              {bgUrl
                ? <img src={bgUrl} alt="Floorplan" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain opacity-60" />
                : <div className="absolute inset-0" style={{
                    backgroundImage: 'linear-gradient(to right,#ffffff0d 1px,transparent 1px),linear-gradient(to bottom,#ffffff0d 1px,transparent 1px)',
                    backgroundSize: `${sx(25)}px ${sx(25)}px` }} />}

              <svg
                className="absolute inset-0 size-full touch-none"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerLeave={() => setCursor(null)}
                onDoubleClick={endChain}
                style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
              >
                {rooms.map(r => (
                  <polygon key={r.id}
                    points={r.polygon.map(p => `${sx(toPx(p.x))},${sx(toPx(p.z))}`).join(' ')}
                    fill="#E8A33D" fillOpacity={0.09} stroke="#E8A33D" strokeOpacity={0.45} strokeWidth={1.5} />
                ))}

                {walls.map(w => {
                  const a: P = [toPx(w.a.x), toPx(w.a.z)], b: P = [toPx(w.b.x), toPx(w.b.z)]
                  const on = selected === w.id
                  return (
                    <g key={w.id}>
                      <line x1={sx(a[0])} y1={sx(a[1])} x2={sx(b[0])} y2={sx(b[1])}
                        stroke={on ? '#F2BE6B' : '#DCE3E8'} strokeWidth={on ? 5 : 3.5} strokeLinecap="round" />
                      {/* Fat invisible stroke: a 3px line is untappable on a phone. */}
                      <line x1={sx(a[0])} y1={sx(a[1])} x2={sx(b[0])} y2={sx(b[1])}
                        stroke="transparent" strokeWidth={20} strokeLinecap="round"
                        style={{ cursor: tool === 'select' ? 'pointer' : 'crosshair' }}
                        onPointerDown={e => { if (tool !== 'select') return; e.stopPropagation(); setSelected(w.id) }} />
                    </g>
                  )
                })}

                {/* in-progress */}
                {chain.length > 0 && (
                  <polyline points={chain.map(p => `${sx(p[0])},${sx(p[1])}`).join(' ')}
                    fill="none" stroke="#E8A33D" strokeWidth={2.5} strokeDasharray="6 4" />
                )}
                {previewFrom && cursor && (
                  <>
                    <line x1={sx(previewFrom[0])} y1={sx(previewFrom[1])} x2={sx(cursor[0])} y2={sx(cursor[1])}
                      stroke="#E8A33D" strokeWidth={2.5} strokeDasharray="6 4" />
                    <text x={sx((previewFrom[0] + cursor[0]) / 2) + 8} y={sx((previewFrom[1] + cursor[1]) / 2) - 6}
                      fontSize={12} fill="#F2BE6B" className="tnum">
                      {lengthM(previewFrom, cursor).toFixed(2)} m
                    </text>
                  </>
                )}
                {rectPreview && (
                  <>
                    <rect x={sx(rectPreview.x)} y={sx(rectPreview.y)} width={sx(rectPreview.w)} height={sx(rectPreview.h)}
                      fill="#E8A33D" fillOpacity={0.08} stroke="#E8A33D" strokeWidth={2.5} strokeDasharray="6 4" />
                    <text x={sx(rectPreview.x) + 6} y={sx(rectPreview.y) - 6} fontSize={12} fill="#F2BE6B" className="tnum">
                      {(rectPreview.w * (mpp ?? 0)).toFixed(2)} × {(rectPreview.h * (mpp ?? 0)).toFixed(2)} m
                    </text>
                  </>
                )}
                {chain.map((p, i) => <circle key={i} cx={sx(p[0])} cy={sx(p[1])} r={4.5} fill="#E8A33D" />)}
                {cursor && tool !== 'select' && (
                  <circle cx={sx(cursor[0])} cy={sx(cursor[1])} r={5} fill="none" stroke="#F2BE6B" strokeWidth={2} />
                )}

                {scalePts.map((p, i) => <circle key={i} cx={sx(p[0])} cy={sx(p[1])} r={5} fill="#58A6FF" />)}
                {scalePts.length === 2 && (
                  <line x1={sx(scalePts[0][0])} y1={sx(scalePts[0][1])} x2={sx(scalePts[1][0])} y2={sx(scalePts[1][1])}
                    stroke="#58A6FF" strokeWidth={2} />
                )}

                {placed.map(l => (
                  <g key={l.id} onPointerDown={e => {
                    if (tool !== 'select') return
                    e.stopPropagation()
                    void saveLocation({ id: l.id, pos: null })
                  }}>
                    <circle cx={sx(toPx(l.pos!.x))} cy={sx(toPx(l.pos!.z))} r={14} fill="transparent" />
                    <circle cx={sx(toPx(l.pos!.x))} cy={sx(toPx(l.pos!.z))} r={7} fill="#E8A33D" fillOpacity={0.9} />
                    <text x={sx(toPx(l.pos!.x)) + 12} y={sx(toPx(l.pos!.z)) + 4} fontSize={11} fill="#C6CED4">{l.name}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          {tool === 'marker' && (
            <div className="panel mt-3 px-3 py-3">
              <Field label="Which place are you marking?">
                <select value={markerFor} onChange={e => setMarkerFor(e.target.value)}>
                  <option value="">Choose a place…</option>
                  {unplaced.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  {placed.map(l => <option key={l.id} value={l.id}>{l.name} (move)</option>)}
                </select>
              </Field>
              {!locations.length && (
                <p className="mt-2 text-[0.68rem] text-ink-500">
                  Add cupboards under <Link to="/places" className="text-brass-400">Places</Link> first.
                </p>
              )}
            </div>
          )}

          <div className="panel mt-3 px-3 py-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Wall height" hint="metres">
                <input type="number" step="0.01" value={plan.wallHeight}
                  onChange={e => savePlan({ wallHeight: Number(e.target.value) })} />
              </Field>
              <Field label="Scale" hint="metres per pixel">
                <input type="text" readOnly value={mpp ? mpp.toFixed(5) : 'not set'} />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn btn-ghost text-xs" onClick={() => fileRef.current?.click()}>
                {bgUrl ? 'Replace plan image' : 'Add plan image'}
              </button>
              {walls.length > 0 && (
                <button className="btn btn-ghost text-xs text-ink-400" onClick={() => edit({ walls: [] })}>Clear walls</button>
              )}
              {rooms.length > 0 && (
                <button className="btn btn-ghost text-xs text-ink-400" onClick={() => edit({ rooms: [] })}>Clear rooms</button>
              )}
            </div>
          </div>

          {rooms.length > 0 && (
            <div className="panel mt-3 overflow-hidden">
              <header className="border-b border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Rooms</header>
              <ul>
                {rooms.map(r => (
                  <li key={r.id} className="flex items-center gap-2 border-b border-ink-700/60 px-3 py-2 text-sm last:border-0">
                    <span className="flex-1 text-ink-200">{r.name}</span>
                    <button className="px-2 text-ink-500 hover:text-rose-300"
                      onClick={() => edit({ rooms: rooms.filter(x => x.id !== r.id) })}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files)} />

      <Sheet
        open={scaleAsk}
        onClose={() => { setScaleAsk(false); setScalePts([]) }}
        title="How long is that line?"
        footer={
          <button className="btn btn-primary w-full" onClick={async () => {
            const m = Number(scaleMetres)
            const px = Math.hypot(scalePts[1][0] - scalePts[0][0], scalePts[1][1] - scalePts[0][1])
            if (m > 0 && px > 0) await savePlan({ metresPerPixel: m / px })
            setScaleAsk(false); setScalePts([]); setTool('rect')
            setHint('Scale set. Drag out a room box to start.')
          }}>Set scale</button>
        }
      >
        <Field label="Real-world distance" hint="metres">
          <input type="number" step="0.1" autoFocus value={scaleMetres} onChange={e => setScaleMetres(e.target.value)} />
        </Field>
        <p className="mt-2 text-[0.68rem] leading-relaxed text-ink-500">
          Pick something you can trust — a printed dimension, or a door at 0.9 m.
          Everything else scales from this one number.
        </p>
      </Sheet>

      <Sheet
        open={!!roomAsk}
        onClose={() => setRoomAsk(null)}
        title="Name this room"
        footer={
          <button className="btn btn-primary w-full" disabled={!roomName.trim()} onClick={() => {
            if (!roomAsk) return
            const room: Room = {
              id: uid(), name: roomName.trim(),
              polygon: roomAsk.map(([x, y]) => ({ x: toM(x), z: toM(y) }) as Pt),
            }
            edit({ rooms: [...rooms, room] })
            setRoomAsk(null); setRoomName('')
          }}>Add room</button>
        }
      >
        <Field label="Room name"><input type="text" autoFocus placeholder="Kitchen" value={roomName} onChange={e => setRoomName(e.target.value)} /></Field>
      </Sheet>
    </div>
  )
}

const HELP: Record<Tool, string> = {
  select: 'Tap a wall to select it, then Delete. Tap a marker to remove it.',
  scale: 'Tap two points a known distance apart, then type the distance.',
  rect: 'Tap one corner, then the opposite corner — draws four walls and offers to name the room.',
  wall: 'Tap corner to corner. Near-straight lines snap square; ends snap together. Esc or double-tap to finish a run.',
  room: 'Tap around the room, then tap the first point again to close it.',
  marker: 'Pick a place below, then tap where it sits.',
}
