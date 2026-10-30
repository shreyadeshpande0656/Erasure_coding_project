// Talks to the Python bridge (app.py), which runs the real C++ programs.
async function call(path, opts) {
  const r = await fetch(path, opts)
  let j = {}
  try { j = await r.json() } catch (e) { /* not JSON */ }
  if (!r.ok) throw new Error(j.error || `request failed (${r.status})`)
  return j
}

export const getSamples = () => call('/api/samples')
export const getCode = () => call('/api/code')
export const runTransfer = (opts) =>
  call('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) })
export const downloadUrl = (id) => `/api/download/${id}`
