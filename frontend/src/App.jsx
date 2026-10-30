import React, { useEffect, useState } from 'react'
import TransferLab from './pages/TransferLab.jsx'
import EncodingVisualizer from './pages/EncodingVisualizer.jsx'
import DecodingVisualizer from './pages/DecodingVisualizer.jsx'
import { getSamples, runTransfer } from './api.js'

const TABS = [['lab', 'Transfer Lab'], ['enc', 'Encoding Visualizer'], ['dec', 'Decoding Visualizer']]

export default function App() {
  const [tab, setTab] = useState('lab')
  const [samples, setSamples] = useState([])
  const [ready, setReady] = useState(true)
  const [sample, setSample] = useState('')
  const [settings, setSettings] = useState({ loss: 0.3, ack_loss: 0, reorder: false, topup: true })
  const [run, setRun] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getSamples().then((r) => {
      setSamples(r.samples); setReady(r.programs_ready)
      const first = r.samples.find((s) => s.ok)
      if (first) setSample(first.name)
    }).catch((e) => setError('Cannot reach app.py: ' + e.message))
  }, [])

  const start = async () => {
    setRunning(true); setError('')
    try {
      const r = await runTransfer({
        sample, loss: settings.loss, coded: true, topup: settings.topup, latency: 450,
        jitter: settings.reorder ? 350 : 0, ack_loss: settings.ack_loss,
      })
      setRun(r)
    } catch (e) { setError(e.message) } finally { setRunning(false) }
  }

  return (
    <div className="app">
      <header className="top">
        <h1>Erasure-Coded File Transfer</h1>
        <p>Real C++ client and server over UDP, replayed step by step.</p>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}</button>
        ))}
      </nav>
      <main>
        {tab === 'lab' && <TransferLab samples={samples} sample={sample} setSample={setSample} settings={settings}
          setSettings={setSettings} run={run} running={running} error={error} onStart={start} programsReady={ready} />}
        {tab === 'enc' && <EncodingVisualizer run={run} />}
        {tab === 'dec' && <DecodingVisualizer run={run} />}
      </main>
    </div>
  )
}
