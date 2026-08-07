import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { LOCATION_KINDS, type LocationKind } from '../types'
import { uploadPhoto } from '../lib/images'
import { parseTags, tagCloud } from '../lib/tags'
import { Field, Sheet } from '../ui/primitives'

/**
 * Camera first.
 *
 * Cataloguing used to demand the type-first order: create a place, name it,
 * pick a kind, save, reopen it, then add a photo — the photo block was gated
 * on the place already existing. Standing in front of an open cupboard with a
 * phone in one hand, that is exactly backwards. Here the shutter is the first
 * thing that happens and everything else is answered while looking at the
 * picture you just took.
 *
 * The room persists between saves, because nobody photographs one cupboard in
 * the kitchen and then one in the yard — you do a room at a time.
 */
export default function SnapPlace({
  open, onClose, onDone, presetRoomId,
}: {
  open: boolean
  onClose: () => void
  onDone?: (id: string) => void
  /** Opened from inside a room — that room is the answer, don't ask again. */
  presetRoomId?: string
}) {
  const locations = useStore(s => s.locations)
  const plan = useStore(s => s.plan)
  const saveLocation = useStore(s => s.saveLocation)
  const fileRef = useRef<HTMLInputElement>(null)

  const [shot, setShot] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<LocationKind>('cabinet')
  const [roomId, setRoomId] = useState(presetRoomId ?? '')
  const [contents, setContents] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string[]>([])

  // Opening the picker has to happen inside the tap that opened this, or iOS
  // refuses to show the camera.
  useEffect(() => {
    if (open && !shot && !preview) fileRef.current?.click()
  }, [open, shot, preview])

  useEffect(() => {
    if (!open) {
      setShot(null); setPreview(null); setName(''); setContents(''); setDone([])
    } else if (presetRoomId) {
      setRoomId(presetRoomId)
    }
  }, [open, presetRoomId])

  const take = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) {
      // Camera cancelled and nothing captured yet — there is nothing to fill in.
      if (!shot) onClose()
      return
    }
    // Show it immediately; the upload can finish while the form is filled in.
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      setShot(await uploadPhoto(file, 'locations', name || 'cupboard'))
    } catch {
      setShot(null)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const tags = parseTags(contents)
  const suggestions = useMemo(
    () => tagCloud(locations.map(l => l.contents))
      .map(t => t.tag)
      .filter(t => !tags.includes(t))
      .slice(0, 12),
    [locations, tags],
  )

  const save = async (another: boolean) => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const id = await saveLocation({
        name: name.trim(),
        kind,
        roomId: roomId || null,
        parentId: null,
        contents: contents.trim(),
        shots: shot ? { open: shot, closed: null } : undefined,
        photoUrls: [],
      })
      setDone(d => [name.trim(), ...d])
      if (another) {
        // Keep the room; clear everything that is about this one cupboard.
        setName(''); setContents(''); setShot(null); setPreview(null)
        setTimeout(() => fileRef.current?.click(), 150)
      } else {
        onClose()
        onDone?.(id)
      }
    } finally { setBusy(false) }
  }

  const ready = !!name.trim() && !uploading

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => take(e.target.files)}
      />

      <Sheet
        open={open && !!preview}
        onClose={onClose}
        title="New cupboard"
        footer={
          <div className="flex gap-2">
            <button className="btn btn-primary flex-[2]" disabled={!ready || busy} onClick={() => save(true)}>
              Save · snap the next
            </button>
            <button className="btn btn-ghost flex-1" disabled={!ready || busy} onClick={() => save(false)}>
              Save · done
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {preview && (
            <div className="relative overflow-hidden rounded-xl border border-ink-700">
              <img src={preview} alt="" className="aspect-[3/2] w-full object-cover" />
              <button
                className="absolute right-2 top-2 rounded-lg bg-ink-950/85 px-2.5 py-1.5 text-micro font-semibold text-ink-300"
                onClick={() => fileRef.current?.click()}
              >Retake</button>
              {uploading && (
                <div className="absolute inset-x-0 bottom-0 bg-ink-950/85 px-3 py-1 text-micro text-ink-400">
                  Saving the photo…
                </div>
              )}
            </div>
          )}

          {/* Asking "what is it called" invites a label nobody would ever say
              out loud. Asking where it is gets you the sentence you would
              actually use to send someone to fetch something — which is also
              the string that has to work in a search result. */}
          <Field label="Where is this cupboard" hint="how you would describe it">
            <input
              type="text"
              autoFocus
              placeholder="Under the sink, left of the hob"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Room">
              <select value={roomId} onChange={e => setRoomId(e.target.value)}>
                <option value="">—</option>
                {plan.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Kind">
              <select value={kind} onChange={e => setKind(e.target.value as LocationKind)}>
                {LOCATION_KINDS.map(k => (
                  <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="What is in it" hint="tag it with #">
            <textarea
              rows={2}
              placeholder="#cups #teacups #wine #beer"
              value={contents}
              onChange={e => setContents(e.target.value)}
            />
          </Field>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map(t => (
                <span key={t} className="chip border-brass-500/40 bg-brass-400/12 text-brass-300">#{t}</span>
              ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div>
              <div className="mb-1 text-micro text-ink-500">Used elsewhere — tap to add</div>
              <div className="flex flex-wrap gap-1">
                {suggestions.map(t => (
                  <button
                    key={t}
                    className="chip border-ink-600 bg-ink-800 text-ink-400"
                    onClick={() => setContents(c => `${c.trim()} #${t}`.trim())}
                  >#{t}</button>
                ))}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <div className="rounded-lg bg-ink-850 px-3 py-2">
              <div className="text-micro font-medium text-ink-500">Added this session ({done.length})</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-300">{done.join(' · ')}</div>
            </div>
          )}
        </div>
      </Sheet>
    </>
  )
}
