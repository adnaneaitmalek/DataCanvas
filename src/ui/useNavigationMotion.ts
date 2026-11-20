import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

const anchors = [
  { selector: '.site-shell .brand', alignment: 0 },
  { selector: '.site-shell nav', alignment: 0.5 },
  { selector: '.shell-workspaces', alignment: 1 },
]
const ease = 'cubic-bezier(0.22, 1, 0.36, 1)'
type Position = { x: number }
type Navigation = { animate: boolean; positions: Map<string, Position> }

/** The router commits immediately. The persistent header moves and incoming content fades. */
export function useNavigationMotion(view: string, workspaceId?: string) {
  const pending = useRef<Navigation | undefined>(undefined)
  const animations = useRef<Animation[]>([])
  const pointerInput = useRef(true)

  const cancel = useCallback(() => {
    for (const animation of animations.current) animation.cancel()
    animations.current = []
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const pointer = () => { pointerInput.current = true; delete root.dataset.keyboardNavigation }
    const keyboard = () => {
      pointerInput.current = false
      root.dataset.keyboardNavigation = 'true'
      cancel()
    }
    const reset = () => { cancel(); pending.current = undefined }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    window.addEventListener('resize', reset)
    preference.addEventListener('change', reset)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('resize', reset)
      preference.removeEventListener('change', reset)
      delete root.dataset.keyboardNavigation
      cancel()
    }
  }, [cancel])

  const prepare = useCallback(() => {
    const positions = new Map<string, Position>()
    for (const { selector, alignment } of anchors) {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      if (rect) positions.set(selector, { x: rect.left + rect.width * alignment })
    }
    // Measure before cancelling so rapid navigation continues from the visible position.
    cancel()
    pending.current = {
      positions,
      animate: pointerInput.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  }, [cancel])

  useLayoutEffect(() => {
    const navigation = pending.current
    if (!navigation) return
    if (navigation.animate) {
      for (const { selector, alignment } of anchors) {
        const element = document.querySelector<HTMLElement>(selector)
        const before = navigation.positions.get(selector)
        if (!element || !before || typeof element.animate !== 'function') continue
        const after = element.getBoundingClientRect()
        const x = before.x - after.left - after.width * alignment
        if (Math.abs(x) < 0.5 && alignment !== 0.5) continue
        animations.current.push(element.animate([
          { transform: `translateX(${x}px)`, opacity: alignment === 0.5 ? 0.7 : 1 },
          { transform: 'none', opacity: 1 },
        ], { duration: 240, easing: ease }))
      }
    }
    if (view === 'loading') {
      // Restoring an IndexedDB workspace must not animate the temporary loading view.
      pending.current = { ...navigation, positions: new Map() }
      return
    }
    pending.current = undefined
    const main = document.querySelector('main')
    if (navigation.animate && main && typeof main.animate === 'function') animations.current.push(main.animate([
      { opacity: 0.75 },
      { opacity: 1 },
    ], { duration: 160, easing: ease }))
  }, [view, workspaceId])

  return prepare
}
