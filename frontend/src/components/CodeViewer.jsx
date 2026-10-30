import React, { useEffect, useState } from 'react'
import { getCode } from '../api.js'

const KEYWORDS = /\b(if|else|for|while|return|const|uint8_t|uint32_t|int|bool|void|struct|class|static|size_t|auto|true|false|std|break|continue|new|switch|case)\b/g

function highlight(line) {
  const ci = line.indexOf('//')
  const code = ci >= 0 ? line.slice(0, ci) : line
  const comment = ci >= 0 ? line.slice(ci) : ''
  const parts = []
  let last = 0
  code.replace(/\b(if|else|for|while|return|const|uint8_t|uint32_t|uint64_t|int|bool|void|struct|class|static|size_t|auto|true|false|std|break|continue|new|switch|case)\b|\b\d+\b/g, (m, kw, off) => {
    if (off > last) parts.push(code.slice(last, off))
    parts.push(<span key={off} className={kw ? 'kw' : 'num'}>{m}</span>)
    last = off + m.length
    return m
  })
  if (last < code.length) parts.push(code.slice(last))
  if (comment) parts.push(<span key="c" className="cm">{comment}</span>)
  return parts
}

let cache = null

// Real C++ source (read from backend/ by the bridge), collapsed by default.
export default function CodeViewer({ names, active, notes }) {
  const [code, setCode] = useState(cache)
  const [sel, setSel] = useState(active || names[0])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (cache) return
    getCode().then((c) => { cache = c; setCode(c) }).catch((e) => setErr(e.message))
  }, [])
  useEffect(() => { if (active && names.includes(active)) setSel(active) }, [active, names])

  const snip = code && code[sel]
  return (
    <details className="code-panel">
      <summary>View C++ Implementation</summary>
      <div className="code-tabs" role="tablist">
        {names.map((n) => (
          <button key={n} role="tab" aria-selected={sel === n} className={sel === n ? 'on' : ''} onClick={() => setSel(n)}>
            {(notes && notes[n] && notes[n].title) || n}
          </button>
        ))}
      </div>
      {notes && notes[sel] && <p className="code-note">{notes[sel].text}</p>}
      {err && <p className="err">{err}</p>}
      {snip && <>
        <div className="code-file">{snip.file}</div>
        <pre className="code">{snip.code.split('\n').map((l, i) => <div key={i} className="ln"><span className="no">{i + 1}</span>{highlight(l)}</div>)}</pre>
      </>}
    </details>
  )
}
