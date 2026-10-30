import React, { useEffect, useMemo, useState } from 'react'
import FileSelector from '../components/FileSelector.jsx'
import PlaybackControls from '../components/PlaybackControls.jsx'
import Tip from '../components/Tip.jsx'
import { useTimePlayer } from '../lib/usePlayer.js'
import { buildTransfer, statsAt, DROP_AT } from '../lib/events.js'
import { blockColor, blabel, label } from '../lib/colors.js'

const W = 1000, H = 330
const X0 = 214, X1 = 776            // packet path from client edge to server edge
const rowY = (seq) => 92 + (seq % 4) * 50
const lerp = (a, b, p) => a + (b - a) * p
const clamp01 = (v) => Math.max(0, Math.min(1, v))

function Packet({ x, y, text, kind, fade = 1, ring }) {
  const fill = { transit: '#4c8dff', ok: '#2fd18b', lost: '#ff5470', late: '#5b6b8a', meta: '#ffb648', ack: '#2fd18b' }[kind]
  return (
    <g transform={`translate(${x - 24},${y - 13})`} opacity={fade}>
      {ring && <rect x="-4" y="-4" width="56" height="34" rx="9" fill="none" stroke="#a78bfa" strokeWidth="2.5" />}
      <rect width="48" height="26" rx="7" fill={fill} />
      {kind === 'lost'
        ? <path d="M16 6l16 14M32 6L16 20" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        : <text x="24" y="17.5" textAnchor="middle" fontSize="12" fontWeight="700" fill={kind === 'meta' ? '#241a00' : '#04111f'}>{text}</text>}
    </g>
  )
}

function Lane({ m, T, loss }) {
  const els = []
  const st = statsAt(m, T)
  // META
  if (m.meta) {
    const p = (T - m.meta.tSent) / m.meta.delay
    if (p >= 0 && p <= 1) els.push(<Packet key="meta" x={lerp(X0, X1, p)} y={H / 2 - 4} text="META" kind="meta" />)
    else if (p > 1) els.push(<Packet key="meta" x={X1} y={H / 2 - 4} text="META" kind="meta" fade={clamp01(1 - (p - 1) * m.meta.delay / 600)} />)
  }
  // data packets
  for (const p of m.packets) {
    const prog = (T - p.tSent) / p.delay
    if (prog < 0) continue
    const y = rowY(p.seq)
    if (p.dropped) {
      if (prog < DROP_AT) els.push(<Packet key={p.seq} x={lerp(X0, X1, prog)} y={y} text={label(p.seq)} kind="transit" />)
      else {
        const f = 1 - (T - p.tLand) / 900
        if (f > 0) els.push(<Packet key={p.seq} x={lerp(X0, X1, DROP_AT)} y={y} kind="lost" fade={f} />)
      }
    } else if (prog < 1) {
      els.push(<Packet key={p.seq} x={lerp(X0, X1, prog)} y={y} text={label(p.seq)} kind="transit" />)
    } else {
      const f = 1 - (T - p.tArrive) / 700
      if (f > 0) els.push(<Packet key={p.seq} x={X1} y={y} text={label(p.seq)} kind={p.late ? 'late' : 'ok'} ring={p.innovative} fade={f} />)
    }
  }
  // acknowledgments travelling back
  m.acks.forEach((a, i) => {
    const prog = (T - a.t) / Math.max(1, m.latency)
    if (prog < 0) return
    const y = H - 44
    if (a.lost) {
      if (prog < 0.5) els.push(<Packet key={'a' + i} x={lerp(X1, X0, prog)} y={y} text="ACK" kind="ack" />)
      else if (prog < 1.4) els.push(<Packet key={'a' + i} x={lerp(X1, X0, 0.5)} y={y} kind="lost" fade={1 - (prog - 0.5) / 0.9} />)
    } else if (prog <= 1) els.push(<Packet key={'a' + i} x={lerp(X1, X0, prog)} y={y} text="ACK" kind="ack" />)
  })

  const received = m.packets.filter((p) => !p.dropped && p.tArrive <= T)
  const stopped = m.ackRecv && T >= m.ackRecv.t
  const lossShade = Math.min(0.28, loss * 0.4)
  return (
    <svg className="lane" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Packets travelling from client to server over an unreliable network">
      <defs>
        <linearGradient id="net" x1="0" x2="1"><stop offset="0" stopColor="#ff5470" stopOpacity="0" /><stop offset=".5" stopColor="#ff5470" stopOpacity={lossShade} /><stop offset="1" stopColor="#ff5470" stopOpacity="0" /></linearGradient>
      </defs>
      <rect x="250" y="40" width="500" height="250" rx="20" fill="url(#net)" stroke="#2a3a63" strokeDasharray="5 6" />
      <text x="500" y="62" textAnchor="middle" className="svg-cap">Unreliable network · {Math.round(loss * 100)}% packet loss</text>
      <line x1={X0} x2={X1} y1={H / 2 - 4} y2={H / 2 - 4} stroke="#1f2c4a" strokeDasharray="2 8" />

      {/* client */}
      <g>
        <rect x="16" y="50" width="170" height="240" rx="14" className="node" />
        <text x="101" y="80" textAnchor="middle" className="node-title">CLIENT</text>
        <text x="101" y="100" textAnchor="middle" className="svg-cap">{m.split.name}</text>
        {Array.from({ length: m.k }).map((_, i) => (
          <rect key={i} x={36 + (i % 2) * 70} y={118 + Math.floor(i / 2) * 44} width="60" height="34" rx="7" fill={blockColor(i)} opacity="0.9" />
        ))}
        {Array.from({ length: m.k }).map((_, i) => (
          <text key={'t' + i} x={66 + (i % 2) * 70} y={140 + Math.floor(i / 2) * 44} textAnchor="middle" fontSize="13" fontWeight="700" fill="#07101e">{blabel(i)}</text>
        ))}
        <text x="101" y="244" textAnchor="middle" className="svg-cap">{stopped ? 'ACK received: stopped' : st.sent ? 'encoding + sending…' : 'ready'}</text>
        <circle cx="101" cy="268" r="5" fill={stopped ? '#6b7a99' : st.sent ? '#4c8dff' : '#2a3a63'} />
      </g>

      {/* server */}
      <g>
        <rect x="814" y="50" width="170" height="240" rx="14" className="node" />
        <text x="899" y="80" textAnchor="middle" className="node-title">SERVER</text>
        <text x="899" y="100" textAnchor="middle" className="svg-cap">collects independent packets</text>
        {received.slice(0, 12).map((p, i) => (
          <g key={p.seq} transform={`translate(${832 + (i % 3) * 50},${118 + Math.floor(i / 3) * 34})`}>
            <rect width="44" height="26" rx="6" fill={p.late ? '#33415f' : '#17392f'} stroke={p.innovative ? '#a78bfa' : (p.late ? '#46557a' : '#2fd18b')} strokeWidth={p.innovative ? 2.5 : 1.2} />
            <text x="22" y="17.5" textAnchor="middle" fontSize="12" fontWeight="700" fill={p.late ? '#8da0c4' : '#c9f5df'}>{label(p.seq)}</text>
          </g>
        ))}
        <text x="899" y="272" textAnchor="middle" className="node-rank">Rank {st.rank} / {m.k}</text>
      </g>
      {els}
    </svg>
  )
}

export default function TransferLab({ samples, sample, setSample, settings, setSettings, run, running, error, onStart, programsReady }) {
  const model = useMemo(() => (run ? buildTransfer(run.events) : null), [run])
  const player = useTimePlayer(model ? model.duration : 0)
  const [more, setMore] = useState(false)
  const runId = run ? run.id : null

  useEffect(() => { if (runId) player.restart() }, [runId]) // eslint-disable-line react-hooks/exhaustive-deps

  const st = model ? statsAt(model, player.t) : { sent: 0, received: 0, lost: 0, rank: 0, enough: false, complete: false, failed: false }
  const k = model ? model.k : (samples.find((s) => s.name === sample) || {}).k || 4
  const lossShown = model ? model.split.loss : settings.loss

  let banner = null
  if (st.complete) banner = { cls: 'ok', title: 'Transfer Complete!', text: 'Enough independent packets received. Decoding can begin.' }
  else if (st.failed) banner = { cls: 'bad', title: 'Transfer failed', text: `Only ${st.rank} of ${k} independent packets arrived. The client stopped without sending more, so the file cannot be rebuilt.` }
  let explain = 'The client sends encoded packets through an unreliable network. Some packets may be lost, but the receiver can reconstruct the original file once it receives enough independent information.'
  if (!model) explain = 'Pick a file and press Start Transfer. The real C++ client and server run on this computer over UDP; this page then replays what they recorded.'
  else if (st.enough && !st.complete) explain = 'The server holds enough independent packets and has sent an acknowledgment. Packets already in flight keep arriving until the client receives it and stops.'

  return (
    <section className="page" aria-labelledby="t1">
      <h2 id="t1" className="sr-only">Transfer Lab</h2>
      <FileSelector samples={samples} selected={sample} onSelect={setSample} busy={running} />

      <div className="bar">
        <label className="slider">Packet loss <b>{Math.round(settings.loss * 100)}%</b>
          <input type="range" min="0" max="70" step="5" value={Math.round(settings.loss * 100)} disabled={running}
            onChange={(e) => setSettings({ ...settings, loss: Number(e.target.value) / 100 })} />
        </label>
        <button className="btn link" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Fewer options' : 'More options'}</button>
        <button className="btn primary big" onClick={onStart} disabled={running || !sample || !programsReady}>
          {running ? 'Running real transfer…' : (model ? 'Restart Transfer' : 'Start Transfer')}
        </button>
      </div>
      {more && (
        <div className="bar more">
          <label className="slider">Lost acknowledgments <b>{Math.round(settings.ack_loss * 100)}%</b>
            <input type="range" min="0" max="80" step="10" value={Math.round(settings.ack_loss * 100)} disabled={running}
              onChange={(e) => setSettings({ ...settings, ack_loss: Number(e.target.value) / 100 })} /></label>
          <label className="check"><input type="checkbox" checked={settings.reorder} disabled={running}
            onChange={(e) => setSettings({ ...settings, reorder: e.target.checked })} /> Reorder packets</label>
          <label className="check"><input type="checkbox" checked={settings.topup} disabled={running}
            onChange={(e) => setSettings({ ...settings, topup: e.target.checked })} /> Keep sending until acknowledged</label>
        </div>
      )}
      {!programsReady && <p className="notice bad">The C++ programs are not built yet. Run <code>build.bat</code> (Windows) or <code>sh build.sh</code> (Mac) and restart app.py.</p>}
      {error && <p className="notice bad">{error}</p>}

      <div className="stage">
        {model
          ? <Lane m={model} T={player.t} loss={lossShown} />
          : <div className="lane-empty"><span>CLIENT</span><i /><span>UNRELIABLE NETWORK</span><i /><span>SERVER</span></div>}
        {running && <div className="overlay"><div className="spinner" /><p>Running the real C++ client and server…</p></div>}
      </div>

      {model && (
        <PlaybackControls playing={player.playing} onPlay={player.play} onPause={player.pause} onRestart={player.restart}
          speed={player.speed} setSpeed={player.setSpeed} replayLabel="Replay Transfer" />
      )}

      <div className="stats" aria-live="polite">
        <div className="stat"><span>Packets Sent</span><b>{st.sent}</b></div>
        <div className="stat green"><span>Packets Received</span><b>{st.received}</b></div>
        <div className="stat red"><span>Packets Lost</span><b>{st.lost}</b></div>
        <div className="stat purple"><span><Tip term="Matrix rank">Independent Packets</Tip> (Rank)</span>
          <b>{st.rank}/{k}</b>
          <div className="rankbar">{Array.from({ length: k }).map((_, i) => <i key={i} className={i < st.rank ? 'on' : ''} />)}</div>
        </div>
      </div>

      {banner && <div className={'banner ' + banner.cls}><b>{banner.title}</b><span>{banner.text}</span></div>}
      <p className="explain">{explain}</p>
      <p className="legend">
        <i className="dot blue" /> in transit <i className="dot green" /> received <i className="dot red" /> dropped <i className="dot purple" /> new independent packet
      </p>
    </section>
  )
}
