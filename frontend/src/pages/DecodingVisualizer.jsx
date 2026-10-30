import React, { useMemo } from 'react'
import PlaybackControls from '../components/PlaybackControls.jsx'
import CodeViewer from '../components/CodeViewer.jsx'
import Tip from '../components/Tip.jsx'
import { useStepper } from '../lib/usePlayer.js'
import { buildDecoding } from '../lib/events.js'
import { blockColor, blabel, label } from '../lib/colors.js'
import { downloadUrl } from '../api.js'

function Matrix({ rows, k, hi }) {
  return (
    <div className="mwrap">
      <table className="matrix">
        <thead><tr><th>Packet</th>{Array.from({ length: k }).map((_, i) => <th key={i} style={{ color: blockColor(i) }}>{blabel(i)}</th>)}<th>Data</th></tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={hi && (hi.row === ri ? 'row-hi' : hi.from_row === ri ? 'row-src' : '')}>
              <th>{r.label >= 0 ? label(r.label) : '–'}</th>
              {r.c.map((v, ci) => {
                const piv = hi && hi.col === ci && hi.row === ri
                return <td key={ci} className={(piv ? 'piv ' : '') + (v === 0 ? 'zero' : '')}>{v}</td>
              })}
              <td><code>{r.d.slice(0, 8)}…</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const explainStep = (s) => {
  if (s.kind === 'pivot') return `Pivot: find a row with a non-zero value in column ${blabel(s.col)}${s.swapped ? ' and swap it up' : ''}.`
  if (s.kind === 'normalize') return `Normalize: multiply row ${s.row + 1} by the inverse of its pivot so the pivot becomes 1.`
  return `Eliminate: add ${s.factor} × row ${s.from_row + 1} to row ${s.row + 1} (XOR in GF(256)) to clear column ${blabel(s.col)}.`
}

export default function DecodingVisualizer({ run }) {
  const dec = useMemo(() => (run ? buildDecoding(run.events) : null), [run])
  const steps = dec && dec.matrix ? dec.elim.length : 0
  // step 0 = matrix as received, 1..steps = elimination, steps+1 = result
  const sp = useStepper(dec && dec.matrix ? steps + 2 : 0, 900)

  if (!dec) return <section className="page"><div className="empty">Run a transfer in the <b>Transfer Lab</b> tab first. This tab then shows how the real C++ server rebuilt the file.</div></section>
  if (!dec.matrix) return (
    <section className="page"><div className="card bad-card">
      <h3>Nothing to decode</h3>
      <p>The server never held enough independent packets, so it could not even start Gaussian elimination. Try a lower packet loss, or turn on “Keep sending until acknowledged” in the Transfer Lab.</p>
    </div></section>
  )

  const k = dec.split.k
  const last = sp.idx === steps + 1
  const cur = sp.idx >= 1 && sp.idx <= steps ? dec.elim[sp.idx - 1] : null
  const rows = last ? (dec.elim[steps - 1]?.rows || dec.matrix.rows) : cur ? cur.rows : dec.matrix.rows
  const s = run.summary
  const match = s && s.sha_original && s.sha_original === s.sha_rebuilt

  let title = 'Step 1: the matrix the server received'
  let text = `Each row is one independent packet: its coefficients (left) and its mixed data (right). ${k} rows means ${k} equations for ${k} unknown blocks.`
  if (cur) { title = `Step ${cur.n + 1} of ${steps + 1}: ${cur.kind}`; text = explainStep(cur) }
  if (last) { title = 'Done: identity matrix'; text = 'The left side is now the identity matrix, so each row on the right is exactly one original block.' }

  return (
    <section className="page">
      <h2 className="sr-only">Decoding Visualizer</h2>
      <p className="lede"><Tip term="Gaussian elimination">Gaussian elimination</Tip> over <Tip term="GF(256)">GF(256)</Tip> turns the received packets back into the original blocks.</p>

      <div className="card">
        <h3>{title}</h3>
        <p aria-live="polite">{text}</p>
        <Matrix rows={rows} k={k} hi={cur} />
      </div>

      <PlaybackControls playing={sp.playing} onPlay={sp.play} onPause={sp.pause} onNext={sp.next} onPrev={sp.prev}
        onRestart={sp.restart} speed={sp.speed} setSpeed={sp.setSpeed} replayLabel="Replay" />
      <div className="progress" aria-hidden="true"><i style={{ width: `${(100 * (sp.idx + 1)) / (steps + 2)}%` }} /></div>

      {last && dec.recovered && (
        <div className="card">
          <h3>Recovered blocks</h3>
          <div className="blocks">
            {dec.recovered.blocks.map((b) => (
              <div key={b.index} className="block used" style={{ '--c': blockColor(b.index) }}>
                <b>{blabel(b.index)}</b><code>{b.preview}…</code><span>{b.bytes} bytes</span>
              </div>
            ))}
          </div>
          <div className={'verify ' + (match ? 'ok' : 'bad')}>
            <b>{match ? 'SHA-256 verified: rebuilt file is identical' : 'Rebuilt file does not match the original'}</b>
            <div>original <code>{s.sha_original}</code></div>
            <div>rebuilt&nbsp;&nbsp; <code>{s.sha_rebuilt || 'not written'}</code></div>
            {run.id && s.sha_rebuilt && <a className="btn primary" href={downloadUrl(run.id)}>Download rebuilt file</a>}
          </div>
        </div>
      )}

      <CodeViewer names={['decoder_add', 'gauss', 'server_receive']} active={cur ? 'gauss' : 'decoder_add'}
        notes={{ decoder_add: { title: 'Add packet', text: 'Keeps a packet only if it raises the rank.' },
          gauss: { title: 'Gaussian elimination', text: 'Pivot, normalize and eliminate, one event per step.' },
          server_receive: { title: 'Server receive', text: 'Validates CRC, feeds the decoder and acknowledges once rank = k.' } }} />
    </section>
  )
}
