import React from 'react'

const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
)
const PLAY = 'M8 5v14l11-7z'
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z'
const NEXT = 'M6 6l8.5 6L6 18zM16 6h2v12h-2z'
const PREV = 'M18 6l-8.5 6L18 18zM6 6h2v12H6z'
const RESTART = 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z'

export default function PlaybackControls({ playing, onPlay, onPause, onNext, onPrev, onRestart, speed, setSpeed, replayLabel = 'Restart', disabled, extra }) {
  return (
    <div className="controls" role="group" aria-label="Playback controls">
      {onPrev && <button className="btn" onClick={onPrev} disabled={disabled}><Icon d={PREV} />Previous</button>}
      {playing
        ? <button className="btn primary" onClick={onPause} disabled={disabled}><Icon d={PAUSE} />Pause</button>
        : <button className="btn primary" onClick={onPlay} disabled={disabled}><Icon d={PLAY} />Play</button>}
      {onNext && <button className="btn" onClick={onNext} disabled={disabled}>Next<Icon d={NEXT} /></button>}
      <button className="btn" onClick={onRestart} disabled={disabled}><Icon d={RESTART} />{replayLabel}</button>
      {setSpeed && (
        <label className="speed">Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
        </label>
      )}
      {extra}
    </div>
  )
}
