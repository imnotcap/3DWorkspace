/**
 * Photoreal PDF images with OpenAI's image model (the one behind ChatGPT's images): each
 * path-traced room render is sent with a prompt and comes back as an interior photograph of the
 * same room. Bring your own key; it goes only to api.openai.com, straight from this browser.
 */

export interface RoomBrief {
  name: string
  floor?: string
  walls?: string
  furniture: string[]
}

function prompt(r: RoomBrief) {
  return [
    `Turn this 3D render of a ${r.name.toLowerCase()} into a photorealistic, high-end interior photograph of the very same room.`,
    'Keep the exact camera angle, room layout, walls, windows and doors, and every piece of furniture in the same place, shape, colour and material.',
    r.furniture.length ? `The furniture: ${r.furniture.join(', ')}.` : '',
    r.floor ? `Floor: ${r.floor}.` : '',
    r.walls ? `Walls: ${r.walls}.` : '',
    'Make it look real: soft natural daylight through the windows, accurate global illumination, soft contact shadows, realistic reflections,',
    'fine material detail (wood grain, fabric weave, subtle wear), lamps glowing warmly where they are on.',
    'Architectural interior photography, full-frame camera, wide lens, straight verticals, high dynamic range, magazine quality, sharp focus.',
    'Do not add or remove furniture, no people, no text, no watermark.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Fit `img` into w×h (cover, centred) and encode it. */
async function fit(blob: Blob, w: number, h: number, type: 'image/png' | 'image/jpeg') {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  const k = Math.max(w / bmp.width, h / bmp.height)
  const dw = bmp.width * k
  const dh = bmp.height * k
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh)
  bmp.close()
  return c.convertToBlob({ type, quality: 0.92 })
}

/**
 * Render → photo. Returns a JPEG with the render's own size (the model works at 1536×1024; the
 * result is cropped back to the render's aspect). Throws with OpenAI's message on failure.
 */
export async function photoreal(render: Blob, size: { w: number; h: number }, room: RoomBrief, opts: { key: string; model: string; signal?: AbortSignal }): Promise<Blob> {
  const input = await fit(render, 1536, 1024, 'image/png')
  const form = new FormData()
  form.append('model', opts.model || 'gpt-image-1')
  form.append('image', input, 'render.png')
  form.append('prompt', prompt(room))
  form.append('size', '1536x1024')
  form.append('quality', 'high')
  form.append('input_fidelity', 'high')
  form.append('n', '1')
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${opts.key}` }, body: form, signal: opts.signal })
  const json = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } }
  if (!res.ok || !json.data?.[0]?.b64_json) throw new Error(json.error?.message ?? `OpenAI returned ${res.status}`)
  const bin = atob(json.data[0].b64_json)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return fit(new Blob([bytes], { type: 'image/png' }), size.w, size.h, 'image/jpeg')
}
