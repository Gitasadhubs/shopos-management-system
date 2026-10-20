'use client'
import { useSyncExternalStore } from 'react'
import { checkNow, getConnectivity, subscribe, type ConnectivityState } from '@/lib/connectivity'

const SERVER_STATE: ConnectivityState = { status: 'checking', checking: false, checkedAt: null, latencyMs: null }

// The shared connection checker (lib/connectivity.ts) as React state.
export function useConnectivity() {
  const state = useSyncExternalStore(subscribe, getConnectivity, () => SERVER_STATE)
  return { ...state, online: state.status === 'online', offline: state.status !== 'online' && state.status !== 'checking', checkNow }
}
