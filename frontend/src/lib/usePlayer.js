import { useCallback, useEffect, useRef, useState } from 'react'

// Time-based player: `t` is the animation clock in milliseconds. Pausing only stops this clock;
// it never touches the real network transfer (that already finished and was recorded).
export function useTimePlayer(duration) {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const tRef = useRef(0)
  const speedRef = useRef(1)
  speedRef.current = speed

  useEffect(() => {
    if (!playing) return undefined
    let id = 0
    let last = 0
    const tick = (ts) => {
      const dt = last ? Math.min(80, ts - last) : 0
      last = ts
      let n = tRef.current + dt * speedRef.current
      if (n >= duration) { n = duration; tRef.current = n; setT(n); setPlaying(false); return }
      tRef.current = n
      setT(n)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, duration])

  const seek = useCallback((v) => { tRef.current = v; setT(v) }, [])
  const play = useCallback(() => { if (tRef.current >= duration) seek(0); setPlaying(true) }, [duration, seek])
  const pause = useCallback(() => setPlaying(false), [])
  const restart = useCallback(() => { seek(0); setPlaying(true) }, [seek])
  return { t, playing, speed, setSpeed, play, pause, restart, seek, done: t >= duration && duration > 0 }
}

// Step-based player for the Encoding and Decoding tabs: `idx` is the current step.
export function useStepper(count, intervalMs = 1500) {
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => { setIdx(0); setPlaying(false) }, [count])
  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= count - 1) { setPlaying(false); return i }
        return i + 1
      })
    }, intervalMs / speed)
    return () => clearInterval(id)
  }, [playing, count, intervalMs, speed])

  return {
    idx, playing, speed, setSpeed, setIdx,
    play: () => { if (idx >= count - 1) setIdx(0); setPlaying(true) },
    pause: () => setPlaying(false),
    next: () => { setPlaying(false); setIdx((i) => Math.min(count - 1, i + 1)) },
    prev: () => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)) },
    restart: () => { setIdx(0); setPlaying(true) },
    last: idx >= count - 1,
  }
}
