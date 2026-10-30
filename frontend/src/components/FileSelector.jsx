import React from 'react'

const ICON = { Image: '🖼', 'PDF document': '📄', 'Text file': '📝' }

export default function FileSelector({ samples, selected, onSelect, busy }) {
  return (
    <div className="file-cards" role="radiogroup" aria-label="Sample file">
      {samples.map((s) => (
        <button key={s.name} role="radio" aria-checked={selected === s.name}
          className={'file-card' + (selected === s.name ? ' on' : '')} onClick={() => onSelect(s.name)} disabled={busy || !s.ok}>
          <span className="file-ico" aria-hidden="true">{ICON[s.type] || '📁'}</span>
          <span className="file-meta">
            <b>{s.name}</b>
            <span>{s.type} · {(s.size / 1000).toFixed(1)} KB</span>
            <span>{s.k} source blocks of {s.block} B</span>
          </span>
        </button>
      ))}
    </div>
  )
}
