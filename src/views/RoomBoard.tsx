import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { uploadPhoto } from '../lib/images'
import { parseTags } from '../lib/tags'
import { Sheet } from '../ui/primitives'
import PlaceSheet from './PlaceSheet'
import SnapPlace from './SnapPlace'

/**
 * The room, as a photograph you can point at.
 *
 * This is what the 3D model was reaching for and never got to. A doll's house
 * built out of traced walls told you a cupboard was "in the kitchen, north
 * side" — which you already knew. A wide shot of your own kitchen with a dot on
 * the cupboard tells you *that* one, the one under the window, and it took a
 * single tap of the shutter instead of an evening of tracing.
 *
 * Pins are stored as fractions of the image, not pixels, so the same pin lands
 * correctly whether the photo is shown 300px wide on a phone or full-bleed on a
 * laptop, and survives the photo being re-uploaded at a different size.
 */
export default function RoomBoard({
  roomId, onClose, onOpenItem,
}: {
  roomId: string | null
  onClose: () => void
  onOpenItem: (id: string) => void
}) {
  const plan = useStore(s => s.plan)
  const locations = useStore(s => s.locations)
  const savePlan = useStore(s => s.savePlan)
  const saveLocation = useStore(s => s.saveLocation)

  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [uploading, setUploading] = useState(false)
  const [placing, setPlacing] = useState<string | null>(null)
  const [openPlace, setOpenPlace] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(false)

  const room = roomId ? plan.rooms.find(r => r.id === roomId) : null

  const cupboards = useMemo(
    () => locations
      .filter(l => l.roomId === roomId)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [locations, roomId],
  )

  if (!room) return null

  // Numbered down the photo rather than alphabetically, so the list below reads
  // in the same order your eye travels across the picture.
  const pinned = cupboards
    .filter(c => c.pin)
    .sort((a, b) => (a.pin!.y - b.pin!.y) || (a.pin!.x - b.pin!.x))
  const loose = cupboards.filter(c => !c.pin)

  const setPhoto = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadPhoto(file, 'locations', `room-${room.name}`)
      await savePlan({ rooms: plan.rooms.map(r => (r.id === room.id ? { ...r, photoUrl: url } : r)) })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // A tap lands wherever the finger did, in image fractions. Clamped, because
  // a tap on the very edge of a rounded corner can report a hair outside.
  const drop = (e: React.MouseEvent) => {
    if (!placing || !imgRef.current) return
    const b = imgRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width))
    const y = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))
    void saveLocation({ id: placing, pin: { x, y } })
    setPlacing(null)
  }

  const placingName = placing ? cupboards.find(c => c.id === placing)?.name : null

  return (
    <>
      <input id="room-photo" ref={fileRef} type="file" accept="image/*" capture="environment"
        className="hidden" onChange={e => void setPhoto(e.target.files)} />

      <Sheet
        open
        wide
        onClose={onClose}
        title={room.name}
        footer={
          placing ? (
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setPlacing(null)}>Cancel</button>
              <button
                className="btn btn-ghost flex-1"
                onClick={() => { void saveLocation({ id: placing, pin: null }); setPlacing(null) }}
              >Remove the dot</button>
            </div>
          ) : (
            <button className="btn btn-primary w-full" onClick={() => setSnapping(true)}>
              + Snap a cupboard in {room.name}
            </button>
          )
        }
      >
        {room.photoUrl ? (
          <div className="space-y-2">
            <div
              className={`relative overflow-hidden rounded-xl border ${
                placing ? 'border-brass-400 ring-2 ring-brass-400/30' : 'border-ink-700'
              }`}
            >
              <img
                ref={imgRef}
                src={room.photoUrl}
                alt={room.name}
                onClick={drop}
                className={`w-full ${placing ? 'cursor-crosshair' : ''}`}
              />

              {pinned.map((c, n) => (
                <button
                  key={c.id}
                  aria-label={c.name}
                  onClick={() => (placing ? undefined : setOpenPlace(c.id))}
                  style={{ left: `${c.pin!.x * 100}%`, top: `${c.pin!.y * 100}%` }}
                  className={`absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center
                    rounded-full border-2 border-white bg-brass-400 text-micro font-bold text-white
                    shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${placing ? 'opacity-40' : ''}`}
                >{n + 1}</button>
              ))}

              {placing && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink-950/85 px-3 py-2 text-center text-mini font-medium text-white">
                  Tap where “{placingName}” is
                </div>
              )}
            </div>

            {!placing && (
              <button
                className="text-mini font-medium text-ink-500 hover:text-ink-300"
                onClick={() => fileRef.current?.click()}
              >{uploading ? 'Uploading…' : 'Replace this photo'}</button>
            )}
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="grid w-full place-items-center gap-2 rounded-xl border border-dashed border-ink-600 px-4 py-10 text-center"
          >
            <span className="text-3xl">📷</span>
            <span className="text-sm font-medium text-ink-200">
              {uploading ? 'Uploading…' : `Take a wide shot of the ${room.name}`}
            </span>
            <span className="max-w-xs text-xs leading-relaxed text-ink-400">
              Stand in the doorway and get the whole room in. Then tap the photo to
              drop a dot on each cupboard.
            </span>
          </button>
        )}

        {loose.length > 0 && (
          <div className="mt-4">
            <div className="text-micro font-semibold uppercase tracking-wider text-ink-500">
              {room.photoUrl ? 'Not on the photo yet — tap one, then tap the photo' : 'In this room'}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {loose.map(c => (
                <button
                  key={c.id}
                  disabled={!room.photoUrl}
                  onClick={() => setPlacing(c.id)}
                  className={`chip ${
                    placing === c.id
                      ? 'border-brass-500/50 bg-brass-400/12 text-brass-300'
                      : 'border-ink-600 bg-ink-800 text-ink-300'
                  } disabled:opacity-60`}
                >{c.name}</button>
              ))}
            </div>
          </div>
        )}

        {pinned.length > 0 && (
          <div className="panel mt-4 overflow-hidden">
            {pinned.map((c, n) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-ink-700/60 px-3 py-2.5 last:border-0">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brass-400 text-micro font-bold text-white">
                  {n + 1}
                </span>
                <button onClick={() => setOpenPlace(c.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-ink-200">{c.name}</div>
                  <div className="truncate text-mini text-ink-400">
                    {parseTags(c.contents).map(t => `#${t}`).join(' ') || c.kind}
                  </div>
                </button>
                <button
                  onClick={() => setPlacing(c.id)}
                  className="shrink-0 text-mini font-medium text-ink-500 hover:text-brass-400"
                >Move</button>
              </div>
            ))}
          </div>
        )}

        {cupboards.length === 0 && (
          <p className="mt-4 text-center text-xs leading-relaxed text-ink-400">
            No cupboards catalogued in here yet.
          </p>
        )}
      </Sheet>

      <PlaceSheet locationId={openPlace} onClose={() => setOpenPlace(null)} onOpenItem={onOpenItem} />
      <SnapPlace open={snapping} onClose={() => setSnapping(false)} presetRoomId={room.id} />
    </>
  )
}
