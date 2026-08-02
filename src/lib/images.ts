import { ref as sref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { storage } from '../firebase'

const MAX_EDGE = 1600
const QUALITY = 0.82

/**
 * Phone cameras produce 4–8 MB HEIC/JPEG files. Uploading those raw would
 * burn the free Storage tier in a week, so everything gets downscaled to a
 * long edge of 1600px before it leaves the device.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>(res =>
    canvas.toBlob(res, 'image/jpeg', QUALITY),
  )
  return blob ?? file
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file'
}

export async function uploadPhoto(
  file: File,
  folder: 'items' | 'locations' | 'plans',
  key: string,
): Promise<string> {
  const isPlan = folder === 'plans'
  const body = isPlan ? file : await shrinkImage(file)
  const ext = isPlan ? (file.name.split('.').pop() || 'png') : 'jpg'
  const path = `${folder}/${slug(key)}-${Date.now()}.${ext}`
  const r = sref(storage, path)
  await uploadBytes(r, body, { contentType: isPlan ? file.type : 'image/jpeg' })
  return await getDownloadURL(r)
}

export async function deletePhoto(url: string): Promise<void> {
  try {
    await deleteObject(sref(storage, url))
  } catch {
    // Already gone, or a URL we do not own. Not worth blocking the UI over.
  }
}

/** Read image natural dimensions without adding it to the DOM. */
export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}
