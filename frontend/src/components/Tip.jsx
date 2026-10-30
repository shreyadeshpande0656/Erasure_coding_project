import React from 'react'

const TERMS = {
  'Erasure coding': 'Adding clever redundancy so a file can be rebuilt even if some pieces never arrive.',
  'Source block': 'One equal-sized piece of the original file. The file is cut into k of them.',
  'Encoded packet': 'A packet whose data is a mathematical mix of the source blocks, not just a copy of one.',
  'GF(256)': 'A number system with 256 values (one byte). Adding is XOR; multiplying follows fixed rules, and every non-zero value has an inverse.',
  'Linear independence': 'A packet is independent if it carries information the receiver does not already have.',
  'Matrix rank': 'How many independent packets the receiver holds. At rank k the file can be rebuilt.',
  'Gaussian elimination': 'Step-by-step row operations that untangle the mixed packets into the original blocks.',
  'Packet loss': 'UDP gives no delivery guarantee: some packets simply vanish on the way.',
}

export default function Tip({ term, children }) {
  const text = TERMS[term]
  if (!text) return <>{children ?? term}</>
  return (
    <span className="tip" tabIndex={0}>
      {children ?? term}
      <span className="tip-box" role="tooltip"><b>{term}</b>{text}</span>
    </span>
  )
}
