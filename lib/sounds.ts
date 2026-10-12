'use client'

import { useSyncExternalStore } from 'react'

// Short interface sounds made with the Web Audio API: no audio files to download or license.
// On by default; the choice is remembered per device.

export type SoundName = 'tap' | 'add' | 'remove' | 'scan' | 'success' | 'sale' | 'error' | 'notify'

const STORAGE_KEY = 'shopos:sound'
const listeners = new Set<() => void>()
let audio: AudioContext | null = null

function readEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

let enabled: boolean | null = null

export function isSoundEnabled() {
  if (typeof window === 'undefined') return false
  enabled ??= readEnabled()
  return enabled
}

export function setSoundEnabled(on: boolean) {
  enabled = on
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Private windows can refuse storage; the choice still holds for this visit.
  }
  listeners.forEach((listener) => listener())
  if (on) playSound('notify')
}

export function useSoundEnabled() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isSoundEnabled,
    () => false,
  )
}

function context() {
  if (typeof window === 'undefined') return null
  const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Audio) return null
  audio ??= new Audio()
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined)
  return audio
}

type Note = { frequency: number; start: number; duration: number; type?: OscillatorType; volume?: number; slideTo?: number }

function play(notes: Note[]) {
  const ctx = context()
  if (!ctx) return
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 0.18
  master.connect(ctx.destination)
  for (const note of notes) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = now + note.start
    const end = start + note.duration
    oscillator.type = note.type ?? 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, start)
    if (note.slideTo) oscillator.frequency.exponentialRampToValueAtTime(note.slideTo, end)
    // Quick attack and exponential release keep the sounds soft and click-free.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(note.volume ?? 0.9, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start(start)
    oscillator.stop(end + 0.02)
  }
}

const SOUNDS: Record<SoundName, Note[]> = {
  tap: [{ frequency: 660, start: 0, duration: 0.05, type: 'triangle', volume: 0.5 }],
  add: [{ frequency: 520, start: 0, duration: 0.07, type: 'triangle' }, { frequency: 780, start: 0.05, duration: 0.09, type: 'triangle' }],
  remove: [{ frequency: 520, start: 0, duration: 0.09, type: 'triangle', slideTo: 330, volume: 0.6 }],
  scan: [{ frequency: 1760, start: 0, duration: 0.08, type: 'square', volume: 0.25 }],
  success: [{ frequency: 523.25, start: 0, duration: 0.12 }, { frequency: 659.25, start: 0.09, duration: 0.12 }, { frequency: 783.99, start: 0.18, duration: 0.22 }],
  // A till "cha-ching": a bright bell over a low thunk.
  sale: [
    { frequency: 140, start: 0, duration: 0.12, type: 'triangle', volume: 0.7 },
    { frequency: 1318.5, start: 0.06, duration: 0.18, type: 'sine', volume: 0.6 },
    { frequency: 1975.5, start: 0.14, duration: 0.42, type: 'sine', volume: 0.5 },
    { frequency: 2637, start: 0.14, duration: 0.3, type: 'sine', volume: 0.2 },
  ],
  error: [{ frequency: 220, start: 0, duration: 0.14, type: 'sawtooth', volume: 0.35 }, { frequency: 175, start: 0.13, duration: 0.2, type: 'sawtooth', volume: 0.35 }],
  notify: [{ frequency: 880, start: 0, duration: 0.1 }, { frequency: 1174.7, start: 0.08, duration: 0.16 }],
}

export function playSound(name: SoundName) {
  if (!isSoundEnabled()) return
  try {
    play(SOUNDS[name])
  } catch {
    // Sound is a nicety; never let it break an action.
  }
}
