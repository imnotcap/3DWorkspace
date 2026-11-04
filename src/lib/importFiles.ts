import { useWorkspace } from '@/store/workspace'

/** Import .glb files from disk straight into the scene. */
export function importModelFiles(files: File[]) {
  const s = useWorkspace.getState()
  for (const f of files) {
    if (!/\.glb$/i.test(f.name)) continue
    s.addObject({ name: f.name.replace(/\.glb$/i, ''), blob: f, source: 'Imported' })
  }
}
