import React, { useMemo } from 'react'
import PlaybackControls from '../components/PlaybackControls.jsx'
import CodeViewer from '../components/CodeViewer.jsx'
import Tip from '../components/Tip.jsx'
import { useStepper } from '../lib/usePlayer.js'
import { buildEncoding } from '../lib/events.js'
import { blockColor, blabel, label } from '../lib/colors.js'

const hex = (v) => v.toString(16).toUpperCase().padStart(2, '0')

export default function EncodingVisualizer({ run }) {
  const enc = useMemo(() => (run ? buildEncoding(run.events, 6) : null), [run])
  const count = enc ? 1 + enc.packets.length : 0
  const sp = useStepper(count, 1800)

  if (!enc) return <section className="page"><div className="empty">Run a transfer in the <b>Transfer Lab</b> tab first. This tab then shows how the real C++ client turned that file into encoded packets.</div></section>

  const k = enc.split.k
  const stepPkt = sp.idx >= 1 ? enc.packets[sp.idx - 1] : null
  const done = sp.idx >= 1 ? enc.packets.slice(0, sp.idx) : []
  const terms = stepPkt ? stepPkt.coefs.map((c, i) => ({ c, i })).filter((x) => x.c !== 0) : []

  let title, text
  if (sp.idx === 0) {
    title = 'Step 1: split the file into source blocks'
    text = `${enc.split.name} (${enc.split.size} bytes) is cut into ${k} equal blocks of ${enc.split.block} bytes${enc.split.padding ? ` (the last one is padded with ${enc.split.padding} zero bytes)` : ''}.`
  } else {
    const sys = terms.length === 1 && terms[0].c === 1
    title = `Step ${sp.idx + 1}: build encoded packet ${label(stepPkt.seq)}`
    text = sys
      ? `The coefficients are 1 for one block and 0 for the rest, so this packet is just a copy of ${blabel(terms[0].i)}.`
      : 'The client picks one random byte per block (the coefficients). Each payload byte is the sum of coefficient × block byte, all in GF(256), where addition is XOR.'
  }

  return (
    <section className="page">
      <h2 className="sr-only">Encoding Visualizer</h2>
      <p className="lede"><Tip term="Erasure coding">Erasure coding</Tip> lets the receiver rebuild the file from <i>any</i> {k} independent packets, so no single packet is special.</p>

      <div className="card">
        <h3>{title}</h3>
        <p>{text}</p>

        <div className="blocks" aria-label="Source blocks">
          {Array.from({ length: k }).map((_, i) => {
            const b = enc.blocks[i]
            const used = stepPkt && stepPkt.coefs[i] !== 0
            return (
              <div key={i} className={'block' + (used ? ' used' : '') + (stepPkt && !used ? ' dim' : '')} style={{ '--c': blockColor(i) }}>
                <b>{blabel(i)}</b>
                <code>{b ? b.preview : '…'}…</code>
                <span>{b ? b.bytes : enc.split.block} bytes</span>
                {stepPkt && <em className="coef">× {stepPkt.coefs[i]}</em>}
              </div>
            )
          })}
        </div>

        {stepPkt && (
          <div className="formula" aria-live="polite">
            <div className="eq">
              <span className="pk">{label(stepPkt.seq)}</span> =
              {terms.map((t, j) => (
                <React.Fragment key={t.i}>
                  {j > 0 && <span className="op">⊕</span>}
                  <span className="term" style={{ '--c': blockColor(t.i) }}>{t.c}·{blabel(t.i)}</span>
                </React.Fragment>
              ))}
            </div>
            <div className="out">
              <span>Coefficients in the header</span>
              <div className="chips">{stepPkt.coefs.map((c, i) => <i key={i} style={{ '--c': blockColor(i) }}>{hex(c)}</i>)}</div>
              <span>Payload (first bytes of {stepPkt.len})</span>
              <code className="payload">{stepPkt.payload.toUpperCase().match(/.{2}/g).join(' ')} …</code>
            </div>
            <p className="note"><Tip term="GF(256)">GF(256)</Tip>: the sum ⊕ is bitwise XOR, so no byte ever overflows.</p>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Encoded packets so far</h3>
        {done.length === 0 ? <p className="muted">None yet. Press Play or Next.</p> : (
          <table className="tbl">
            <thead><tr><th>Packet</th>{Array.from({ length: k }).map((_, i) => <th key={i}>{blabel(i)}</th>)}<th>Payload</th></tr></thead>
            <tbody>
              {done.map((p) => (
                <tr key={p.seq} className={p.seq === (stepPkt && stepPkt.seq) ? 'cur' : ''}>
                  <td><b>{label(p.seq)}</b></td>
                  {p.coefs.map((c, i) => <td key={i} style={c ? { color: blockColor(i) } : undefined}>{c}</td>)}
                  <td><code>{p.payload.slice(0, 12)}…</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PlaybackControls playing={sp.playing} onPlay={sp.play} onPause={sp.pause} onNext={sp.next} onPrev={sp.prev}
        onRestart={sp.restart} speed={sp.speed} setSpeed={sp.setSpeed} replayLabel="Replay" />
      <div className="progress" aria-hidden="true"><i style={{ width: `${(100 * (sp.idx + 1)) / count}%` }} /></div>

      <CodeViewer names={['split', 'make_coeffs', 'encode', 'encode_packet']} active={sp.idx === 0 ? 'split' : 'encode'}
        notes={{ split: { title: 'Split file', text: 'Cuts the file into k equal blocks.' },
          make_coeffs: { title: 'Random coefficients', text: 'Chooses one non-zero-friendly random byte per block.' },
          encode: { title: 'Encode', text: 'Mixes the blocks into one packet payload using GF(256) multiplication and XOR.' },
          encode_packet: { title: 'Build packet', text: 'Wraps the coefficients and payload in the packet header and sends it.' } }} />
    </section>
  )
}
