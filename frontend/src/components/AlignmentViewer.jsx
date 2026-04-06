import { useEffect, useRef } from 'react'

const AMINO_ACID_COLORS = {
  // Hydrophobic (blue)
  A: '#5858f8', V: '#5858f8', I: '#5858f8', L: '#5858f8', M: '#5858f8',
  F: '#6464fa', W: '#6464fa', P: '#7070fc',
  // Polar (green)
  S: '#32cd32', T: '#32cd32', N: '#2db82d', Q: '#2db82d',
  // Charged+ (red)
  K: '#e63946', R: '#e63946', H: '#f07070',
  // Charged- (magenta)
  D: '#e040e0', E: '#e040e0',
  // Special (yellow/orange)
  C: '#ffd700', G: '#ffa500', Y: '#40e0d0',
  // Gap
  '-': '#f0f0f0',
}

export default function AlignmentViewer({ alignmentData }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!alignmentData || !canvasRef.current) return

    const sequences = parseAlignmentData(alignmentData)
    if (sequences.length === 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const charW = 10
    const charH = 18
    const labelW = 180
    const maxLen = Math.max(...sequences.map(s => s.seq.length))

    canvas.width = labelW + maxLen * charW
    canvas.height = sequences.length * charH + 40

    // Header
    ctx.fillStyle = '#374151'
    ctx.font = 'bold 11px monospace'
    ctx.fillText('Alignment Viewer — colored by amino acid properties', 10, 14)

    // Draw sequences
    sequences.forEach((entry, row) => {
      const y = row * charH + 30

      // Label
      ctx.fillStyle = '#1f2937'
      ctx.font = '10px monospace'
      const label = entry.id.length > 22 ? entry.id.slice(0, 22) + '…' : entry.id
      ctx.fillText(label, 4, y + 13)

      // Sequence
      for (let col = 0; col < entry.seq.length; col++) {
        const aa = entry.seq[col].toUpperCase()
        const x = labelW + col * charW

        // Background
        ctx.fillStyle = AMINO_ACID_COLORS[aa] || '#f5f5f5'
        ctx.globalAlpha = 0.35
        ctx.fillRect(x, y, charW, charH)
        ctx.globalAlpha = 1.0

        // Character
        ctx.fillStyle = AMINO_ACID_COLORS[aa] ? '#1a1a2e' : '#9ca3af'
        ctx.font = '11px monospace'
        ctx.fillText(aa, x + 1, y + 13)
      }
    })
  }, [alignmentData])

  if (!alignmentData) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
        No alignment data available yet
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">Multiple Sequence Alignment</h3>
        <div className="flex gap-2 text-xs">
          <span className="px-2 py-1 rounded" style={{ background: '#5858f820', color: '#5858f8' }}>Hydrophobic</span>
          <span className="px-2 py-1 rounded" style={{ background: '#32cd3220', color: '#32cd32' }}>Polar</span>
          <span className="px-2 py-1 rounded" style={{ background: '#e6394620', color: '#e63946' }}>Charged+</span>
          <span className="px-2 py-1 rounded" style={{ background: '#e040e020', color: '#e040e0' }}>Charged−</span>
          <span className="px-2 py-1 rounded" style={{ background: '#ffd70020', color: '#c8a800' }}>Special</span>
        </div>
      </div>
      <div ref={containerRef} className="overflow-auto max-h-[500px]" style={{ maxWidth: '100%' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function parseAlignmentData(text) {
  const lines = text.trim().split('\n')
  const sequences = []
  let currentId = null
  let currentSeq = []

  for (const line of lines) {
    if (line.startsWith('>')) {
      if (currentId) sequences.push({ id: currentId, seq: currentSeq.join('') })
      currentId = line.slice(1).trim().split(/\s+/)[0]
      currentSeq = []
    } else {
      currentSeq.push(line.trim())
    }
  }
  if (currentId) sequences.push({ id: currentId, seq: currentSeq.join('') })

  return sequences
}
