import { useEffect } from 'react'
import { actions } from '@/lib/actions'
import { useWorkspace } from '@/store/workspace'

/** Blender-style single-key shortcuts. Ignored while typing. */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const s = useWorkspace.getState()
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (s.renderJob) return e.key === 'Escape' ? actions.cancelRender() : undefined
      if (mod && e.altKey && (e.code === 'Numpad0' || e.code === 'Digit0')) return e.preventDefault(), actions.cameraFromView()
      if (mod && key === 'f12') return e.preventDefault(), void actions.renderAnimation()
      if (mod && key === 'z') return e.preventDefault(), e.shiftKey ? s.redo() : s.undo()
      if (mod && key === 'y') return e.preventDefault(), s.redo()
      if (mod && key === 'i') return e.preventDefault(), actions.importGlb()
      if (mod && key === 'e') return e.preventDefault(), void actions.exportSelected()
      if (mod) return
      if (e.shiftKey && key === 'n') return s.addProject()
      if (e.shiftKey && key === 'd') return e.preventDefault(), actions.duplicateSelected()

      if (e.shiftKey && key === 'arrowleft') return actions.jump('start')
      if (e.shiftKey && key === 'arrowright') return actions.jump('end')

      switch (key) {
        case 'v': return s.setPlanTool('select')
        case 'w': return s.setPlanTool('wall')
        case 'm': return s.setPlanTool('room')
        case 'd': return s.setPlanTool('door')
        case 'o': return s.setPlanTool('window')
        case 't': return s.setPlanTool('tour')
        case ' ': return e.preventDefault(), actions.togglePlay()
        case '0': return actions.toggleCameraView()
        case 'q': return s.setTool('select')
        case 'g': return s.setTool('translate')
        case 'r': return s.setTool('rotate')
        case 's': return s.setTool('scale')
        case 'f': case '.': return actions.frameSelected()
        case 'home': return actions.frameAll()
        case 'z': return actions.cycleShading()
        case 'n': return s.setPropertyTab(s.propertyTab === 'object' ? null : 'object')
        case 'x': case 'delete': case 'backspace': return actions.deleteSelected()
        case 'escape':
          if (s.placing) return s.setPlacing(null)
          if (s.planTool !== 'select') return s.setPlanTool('select')
          if (s.propertyTab) return s.setPropertyTab(null)
          s.selectPlan(null)
          return s.select(null)
        case 'f12': return e.preventDefault(), void actions.renderImage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
