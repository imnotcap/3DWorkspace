// Kept free of three.js so DOM overlays can use it without pulling in the 3D chunk.

/** Fit a render frame of `aspect` inside the viewport with a margin; returns pixel rect. */
export function frameRect(vpW: number, vpH: number, aspect: number, margin = 0.86) {
  let h = vpH * margin
  let w = h * aspect
  if (w > vpW * margin) {
    w = vpW * margin
    h = w / aspect
  }
  return { w, h, x: (vpW - w) / 2, y: (vpH - h) / 2 }
}
