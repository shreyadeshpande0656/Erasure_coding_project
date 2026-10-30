// Turns the flat list of real C++ trace events into small models the three tabs can draw.

export const DROP_AT = 0.55           // a lost packet vanishes this far along its path

export function buildTransfer(events) {
  const split = events.find((e) => e.type === 'file_split')
  if (!split) return null
  const packets = new Map()
  let meta = null
  let metaRecv = null
  const acks = []
  let ackRecv = null
  let failed = null
  let stop = null
  for (const e of events) {
    if (e.type === 'packet_sent') {
      packets.set(e.seq, { seq: e.seq, tSent: e.t, delay: e.delay_ms, dropped: e.dropped, corrupted: e.corrupted,
        tArrive: null, innovative: false, rank: null, late: false })
    } else if (e.type === 'meta_sent') {
      if (!meta) meta = { tSent: e.t, delay: e.delay_ms, dropped: e.dropped }
    } else if (e.type === 'meta_received') {
      if (!metaRecv) metaRecv = e
    } else if (e.type === 'packet_received') {
      const p = packets.get(e.seq)
      if (p) { p.tArrive = e.t; p.innovative = !!e.innovative; p.rank = e.rank ?? null; p.late = !!e.late }
    } else if (e.type === 'ack_sent') acks.push({ t: e.t, lost: e.lost, copy: e.copy })
    else if (e.type === 'ack_received') ackRecv = e
    else if (e.type === 'transfer_failed') failed = e
    else if (e.type === 'client_stop') stop = e
  }
  const list = [...packets.values()].sort((a, b) => a.seq - b.seq)
  list.forEach((p) => {
    if (!p.dropped && p.tArrive == null) p.tArrive = p.tSent + p.delay
    p.tLand = p.dropped ? p.tSent + DROP_AT * p.delay : p.tArrive
  })
  const rankK = list.filter((p) => p.rank === split.k).map((p) => p.tArrive)
  const tRankK = rankK.length ? Math.min(...rankK) : null
  const latency = split.latency_ms || 0
  // the first copy of the acknowledgment is the one the client reacts to; later copies are repeats
  const ackList = acks.map((a) => ({ ...a, tEnd: a.t + latency }))
  const ends = [stop?.t ?? 0, ackRecv?.t ?? 0, failed?.t ?? 0, ...list.map((p) => p.tLand + 0), ...ackList.map((a) => a.tEnd)]
  const duration = Math.max(...ends) + 900
  return { split, k: split.k, packets: list, meta, metaRecv, acks: ackList, ackRecv, failed, stop, tRankK, latency, duration }
}

export function statsAt(m, T) {
  let sent = 0, received = 0, lost = 0, rank = 0
  for (const p of m.packets) {
    if (p.tSent <= T) sent++
    if (!p.dropped && p.tArrive <= T) received++
    if (p.dropped && p.tLand <= T) lost++
    if (!p.dropped && p.tArrive <= T && p.innovative && p.rank != null && p.rank > rank) rank = p.rank
  }
  const enough = m.tRankK != null && T >= m.tRankK
  const complete = m.ackRecv != null && T >= m.ackRecv.t
  const failed = m.failed != null && T >= m.failed.t
  return { sent, received, lost, rank, enough, complete, failed }
}

export function buildEncoding(events, n = 6) {
  const split = events.find((e) => e.type === 'file_split')
  if (!split) return null
  const blocks = events.filter((e) => e.type === 'block_created')
  const seen = new Set()
  const packets = []
  for (const e of events) {
    if (e.type === 'packet_encoded' && !seen.has(e.seq) && packets.length < n) { seen.add(e.seq); packets.push(e) }
  }
  packets.sort((a, b) => a.seq - b.seq)
  return { split, blocks, packets }
}

export function buildDecoding(events) {
  const split = events.find((e) => e.type === 'file_split')
  if (!split) return null
  const matrix = events.find((e) => e.type === 'decode_matrix')
  const elim = events.filter((e) => e.type === 'elim_step')
  const recovered = events.find((e) => e.type === 'blocks_recovered')
  const written = events.find((e) => e.type === 'file_written')
  const failed = events.find((e) => e.type === 'transfer_failed')
  return { split, matrix, elim, recovered, written, failed }
}
