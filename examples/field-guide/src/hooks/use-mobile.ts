import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function mediaQuery() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
}

function subscribe(onStoreChange: () => void) {
  const query = mediaQuery()
  query.addEventListener('change', onStoreChange)
  return () => query.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return mediaQuery().matches
}

function getServerSnapshot() {
  return false
}
