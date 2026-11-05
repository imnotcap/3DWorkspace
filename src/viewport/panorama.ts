// 360° panoramas: six square 90° views from one point (a cube) stitched into one equirectangular
// picture (2:1, longitude across, latitude down), tagged so photo sites and viewers show it in 360°.

/** The six cube views: where each looks and which way is up for it. */
export const CUBE_FACES: { dir: [number, number, number]; up: [number, number, number] }[] = [
  { dir: [1, 0, 0], up: [0, 1, 0] },
  { dir: [-1, 0, 0], up: [0, 1, 0] },
  { dir: [0, 0, 1], up: [0, 1, 0] },
  { dir: [0, 0, -1], up: [0, 1, 0] },
  { dir: [0, 1, 0], up: [0, 0, -1] },
  { dir: [0, -1, 0], up: [0, 0, 1] },
]

export interface CubeView {
  /** RGBA pixels, `size` × `size`, top row first. */
  data: Uint8ClampedArray
  /** World → camera rotation (row-major 3×3); the camera looks down its −z with +y up. */
  rot: number[]
}

/** The world → camera rotation of a camera looking along `dir` with `up` up (as three's lookAt). */
export function viewRotation(dir: [number, number, number], up: [number, number, number]): number[] {
  // Camera axes in world space: z back (−dir), x right, y up.
  const z = [-dir[0], -dir[1], -dir[2]]
  const zl = Math.hypot(z[0], z[1], z[2])
  z[0] /= zl
  z[1] /= zl
  z[2] /= zl
  const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]
  const xl = Math.hypot(x[0], x[1], x[2])
  x[0] /= xl
  x[1] /= xl
  x[2] /= xl
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  // Rows are the camera axes: camera = R · world.
  return [...x, ...y, ...z]
}

/**
 * Stitch the cube into a `width` × `width / 2` equirectangular picture. The middle of the picture
 * looks along `heading` (radians, 0 = +z, as plan yaw); left of the middle is to the viewer's left.
 */
export function equirect(views: CubeView[], size: number, width: number, heading = 0): Uint8ClampedArray {
  const height = width / 2
  const out = new Uint8ClampedArray(width * height * 4)
  const half = size / 2
  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI
    const cl = Math.cos(lat)
    const dy = Math.sin(lat)
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * 2 * Math.PI - Math.PI
      const a = heading - lon
      const dx = cl * Math.sin(a)
      const dz = cl * Math.cos(a)
      // The view this direction is most head-on to.
      let best = 0
      let depth = -Infinity
      for (let k = 0; k < views.length; k++) {
        const r = views[k].rot
        const d = -(r[6] * dx + r[7] * dy + r[8] * dz)
        if (d > depth) {
          depth = d
          best = k
        }
      }
      const { rot: r, data } = views[best]
      const px = (r[0] * dx + r[1] * dy + r[2] * dz) / depth
      const py = (r[3] * dx + r[4] * dy + r[5] * dz) / depth
      // Bilinear sample at the projected point (90° view: ±1 spans the square).
      const u = Math.min(size - 1.001, Math.max(0, (px + 1) * half - 0.5))
      const v = Math.min(size - 1.001, Math.max(0, (1 - py) * half - 0.5))
      const u0 = Math.floor(u)
      const v0 = Math.floor(v)
      const fu = u - u0
      const fv = v - v0
      const i00 = (v0 * size + u0) * 4
      const i10 = i00 + 4
      const i01 = i00 + size * 4
      const i11 = i01 + 4
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - fu) + data[i10 + c] * fu
        const bottom = data[i01 + c] * (1 - fu) + data[i11 + c] * fu
        out[o + c] = top * (1 - fv) + bottom * fv
      }
      out[o + 3] = 255
    }
  }
  return out
}

/** Add the photo-sphere tags (Google's GPano XMP) to a JPEG so viewers show it in 360°. */
export function tagPanorama(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const xmp =
    'http://ns.adobe.com/xap/1.0/\0' +
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">' +
    '<GPano:ProjectionType>equirectangular</GPano:ProjectionType>' +
    '<GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>' +
    `<GPano:FullPanoWidthPixels>${width}</GPano:FullPanoWidthPixels>` +
    `<GPano:FullPanoHeightPixels>${height}</GPano:FullPanoHeightPixels>` +
    `<GPano:CroppedAreaImageWidthPixels>${width}</GPano:CroppedAreaImageWidthPixels>` +
    `<GPano:CroppedAreaImageHeightPixels>${height}</GPano:CroppedAreaImageHeightPixels>` +
    '<GPano:CroppedAreaLeftPixels>0</GPano:CroppedAreaLeftPixels>' +
    '<GPano:CroppedAreaTopPixels>0</GPano:CroppedAreaTopPixels>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  const body = new TextEncoder().encode(xmp)
  const len = body.length + 2
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || len > 0xffff) return jpeg
  const out = new Uint8Array(jpeg.length + 2 + len)
  out.set([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff])
  out.set(body, 6)
  out.set(jpeg.subarray(2), 6 + body.length)
  return out
}
