import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Search, BarChart3, Eye, EyeOff, Download } from 'lucide-react'
import Plot from 'react-plotly.js'

const AA_COLORS = {
  A: '#2563eb', V: '#2563eb', I: '#2563eb', L: '#2563eb', M: '#2563eb',
  F: '#3b82f6', W: '#3b82f6', P: '#60a5fa',
  S: '#16a34a', T: '#16a34a', N: '#15803d', Q: '#15803d',
  K: '#dc2626', R: '#dc2626', H: '#ef4444',
  D: '#c026d3', E: '#c026d3',
  C: '#eab308', G: '#f97316', Y: '#0d9488',
  '-': '#e5e7eb',
}

const AA_GROUPS = {
  Hydrophobic: { chars: 'AVLIMFWP', color: '#2563eb', bg: '#dbeafe' },
  Polar: { chars: 'STNQ', color: '#16a34a', bg: '#dcfce7' },
  'Charged+': { chars: 'KRH', color: '#dc2626', bg: '#fee2e2' },
  'Charged-': { chars: 'DE', color: '#c026d3', bg: '#fae8ff' },
  Special: { chars: 'CGY', color: '#d97706', bg: '#fef3c7' },
}

export default function AlignmentViewer({ alignmentData, conservationData }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [showConservation, setShowConservation] = useState(true)
  const [showConsensus, setShowConsensus] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [hoveredCell, setHoveredCell] = useState(null)
  const [selectedRegion, setSelectedRegion] = useState(null)
  const [colorMode, setColorMode] = useState('property') // 'property' | 'conservation' | 'identity'

  const sequences = useMemo(() => {
    if (!alignmentData) return []
    return parseAlignmentData(alignmentData)
  }, [alignmentData])

  // Compute per-column conservation
  const conservation = useMemo(() => {
    if (conservationData) return conservationData
    if (sequences.length === 0) return []
    const alnLen = Math.max(...sequences.map(s => s.seq.length))
    const result = []
    for (let col = 0; col < alnLen; col++) {
      const column = sequences.map(s => (s.seq[col] || '-').toUpperCase())
      const nonGap = column.filter(c => c !== '-')
      if (nonGap.length === 0) {
        result.push({ position: col + 1, score: 0, consensus: '-', gapFrac: 1 })
        continue
      }
      const counts = {}
      nonGap.forEach(c => { counts[c] = (counts[c] || 0) + 1 })
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
      const topChar = sorted[0][0]
      const score = sorted[0][1] / column.length
      result.push({
        position: col + 1,
        score: Math.round(score * 10000) / 10000,
        consensus: topChar,
        gapFrac: (column.length - nonGap.length) / column.length,
      })
    }
    return result
  }, [sequences, conservationData])

  const consensusSeq = useMemo(() => conservation.map(c => c.consensus).join(''), [conservation])

  // Search sequences
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const q = searchQuery.toUpperCase()
    const results = []
    sequences.forEach((s, seqIdx) => {
      const seq = s.seq.toUpperCase()
      let pos = seq.indexOf(q)
      while (pos !== -1) {
        results.push({ seqIdx, start: pos, end: pos + q.length - 1 })
        pos = seq.indexOf(q, pos + 1)
      }
    })
    setSearchResults(results)
  }, [searchQuery, sequences])

  // Canvas rendering
  const charW = Math.round(10 * zoom)
  const charH = Math.round(18 * zoom)
  const labelW = Math.round(180 * zoom)
  const consHeight = showConservation ? 60 : 0
  const consensusH = showConsensus ? charH : 0

  useEffect(() => {
    if (!sequences.length || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const alnLen = Math.max(...sequences.map(s => s.seq.length))

    canvas.width = labelW + alnLen * charW + 20
    canvas.height = consHeight + consensusH + sequences.length * charH + 20

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let yOffset = 0

    // Conservation bar plot
    if (showConservation && conservation.length > 0) {
      const barH = consHeight - 8
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(labelW, 0, alnLen * charW, consHeight)

      for (let col = 0; col < conservation.length; col++) {
        const c = conservation[col]
        const x = labelW + col * charW
        const h = c.score * barH
        const hue = c.score > 0.8 ? 142 : c.score > 0.5 ? 45 : 0
        const sat = Math.round(c.score * 80 + 20)
        ctx.fillStyle = `hsla(${hue}, ${sat}%, 45%, 0.7)`
        ctx.fillRect(x, barH - h + 2, charW - 1, h)
      }
      // Axis label
      ctx.fillStyle = '#94a3b8'
      ctx.font = `${Math.max(8, 9 * zoom)}px sans-serif`
      ctx.fillText('Conservation', 4, barH - 2)
      yOffset = consHeight
    }

    // Consensus row
    if (showConsensus && consensusSeq) {
      ctx.fillStyle = '#f1f5f9'
      ctx.fillRect(0, yOffset, canvas.width, charH)
      ctx.fillStyle = '#475569'
      ctx.font = `bold ${Math.max(8, 10 * zoom)}px monospace`
      ctx.fillText('CONSENSUS', 4, yOffset + charH - 4)
      for (let col = 0; col < consensusSeq.length; col++) {
        const aa = consensusSeq[col]
        const x = labelW + col * charW
        ctx.fillStyle = AA_COLORS[aa] || '#9ca3af'
        ctx.globalAlpha = 0.15
        ctx.fillRect(x, yOffset, charW, charH)
        ctx.globalAlpha = 1
        ctx.fillStyle = '#1e293b'
        ctx.font = `bold ${Math.max(8, 11 * zoom)}px monospace`
        ctx.fillText(aa, x + 1, yOffset + charH - 4)
      }
      yOffset += charH
    }

    // Sequences
    sequences.forEach((entry, row) => {
      const y = yOffset + row * charH
      const isSearchHit = searchResults.some(r => r.seqIdx === row)

      // Label
      ctx.fillStyle = isSearchHit ? '#1d4ed8' : '#1f2937'
      ctx.font = `${isSearchHit ? 'bold ' : ''}${Math.max(8, 10 * zoom)}px monospace`
      const maxLabelChars = Math.floor(labelW / (6 * zoom))
      const label = entry.id.length > maxLabelChars ? entry.id.slice(0, maxLabelChars) + '…' : entry.id
      ctx.fillText(label, 4, y + charH - 4)

      for (let col = 0; col < entry.seq.length; col++) {
        const aa = entry.seq[col].toUpperCase()
        const x = labelW + col * charW

        // Check if in search result
        const inSearch = searchResults.some(r => r.seqIdx === row && col >= r.start && col <= r.end)

        // Choose color based on mode
        let bgColor, alpha
        if (colorMode === 'conservation') {
          const c = conservation[col]
          if (c) {
            const hue = c.score > 0.8 ? 142 : c.score > 0.5 ? 45 : 0
            bgColor = `hsl(${hue}, ${Math.round(c.score * 80)}%, 65%)`
            alpha = 0.3 + c.score * 0.4
          } else {
            bgColor = '#f5f5f5'
            alpha = 0.2
          }
        } else if (colorMode === 'identity') {
          const c = conservation[col]
          if (c && aa === c.consensus && aa !== '-') {
            bgColor = '#22c55e'
            alpha = 0.35
          } else if (aa === '-') {
            bgColor = '#e5e7eb'
            alpha = 0.3
          } else {
            bgColor = '#fbbf24'
            alpha = 0.2
          }
        } else {
          bgColor = AA_COLORS[aa] || '#f5f5f5'
          alpha = 0.35
        }

        // Background
        ctx.fillStyle = bgColor
        ctx.globalAlpha = inSearch ? 0.8 : alpha
        ctx.fillRect(x, y, charW, charH)
        ctx.globalAlpha = 1.0

        // Search highlight border
        if (inSearch) {
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, charW, charH)
        }

        // Hover highlight
        if (hoveredCell && hoveredCell.row === row && hoveredCell.col === col) {
          ctx.strokeStyle = '#3b82f6'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, charW, charH)
        }

        // Character
        ctx.fillStyle = inSearch ? '#92400e' : (AA_COLORS[aa] ? '#1a1a2e' : '#9ca3af')
        ctx.font = `${Math.max(8, 11 * zoom)}px monospace`
        if (charW >= 7) {
          ctx.fillText(aa, x + 1, y + charH - 4)
        }
      }
    })

    // Position ruler every 10 cols
    if (charW >= 6) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = `${Math.max(7, 8 * zoom)}px monospace`
      for (let col = 9; col < conservation.length; col += 10) {
        const x = labelW + col * charW
        ctx.fillText(`${col + 1}`, x - 4, yOffset - 2)
      }
    }
  }, [sequences, conservation, consensusSeq, zoom, showConservation, showConsensus, colorMode, searchResults, hoveredCell, charW, charH, labelW, consHeight, consensusH])

  // Mouse tracking
  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const yOff = (showConservation ? 60 : 0) + (showConsensus ? charH : 0)
    if (x < labelW || y < yOff) { setHoveredCell(null); return }
    const col = Math.floor((x - labelW) / charW)
    const row = Math.floor((y - yOff) / charH)
    if (row >= 0 && row < sequences.length && col >= 0) {
      setHoveredCell({ row, col })
    } else {
      setHoveredCell(null)
    }
  }, [sequences, charW, charH, labelW, showConservation, showConsensus])

  // Summary stats
  const stats = useMemo(() => {
    if (!sequences.length) return null
    const alnLen = Math.max(...sequences.map(s => s.seq.length))
    const totalCells = sequences.length * alnLen
    const gaps = sequences.reduce((sum, s) => sum + (s.seq.match(/-/g) || []).length, 0)
    const avgConservation = conservation.length > 0
      ? conservation.reduce((s, c) => s + c.score, 0) / conservation.length
      : 0
    return {
      numSeqs: sequences.length,
      alnLen,
      gapPct: ((gaps / totalCells) * 100).toFixed(1),
      avgCons: (avgConservation * 100).toFixed(1),
    }
  }, [sequences, conservation])

  if (!alignmentData) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
        No alignment data available yet
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-[10px] text-blue-400 uppercase tracking-wider font-medium">Sequences</p>
            <p className="text-lg font-bold text-blue-800">{stats.numSeqs}</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
            <p className="text-[10px] text-purple-400 uppercase tracking-wider font-medium">Alignment Length</p>
            <p className="text-lg font-bold text-purple-800">{stats.alnLen}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-[10px] text-amber-400 uppercase tracking-wider font-medium">Gap %</p>
            <p className="text-lg font-bold text-amber-800">{stats.gapPct}%</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium">Avg Conservation</p>
            <p className="text-lg font-bold text-emerald-800">{stats.avgCons}%</p>
          </div>
        </div>
      )}

      {/* Conservation plot (Plotly) */}
      {showConservation && conservation.length > 0 && conservation.length <= 2000 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <BarChart3 size={14} className="text-emerald-500" /> Conservation Score per Position
            </h4>
          </div>
          <div className="p-2">
            <Plot
              data={[{
                x: conservation.map(c => c.position),
                y: conservation.map(c => c.score),
                type: 'bar',
                marker: {
                  color: conservation.map(c =>
                    c.score > 0.8 ? '#22c55e' : c.score > 0.5 ? '#eab308' : '#ef4444'
                  ),
                },
                hovertemplate: 'Pos %{x}<br>Score: %{y:.3f}<br>Consensus: %{text}<extra></extra>',
                text: conservation.map(c => c.consensus),
              }]}
              layout={{
                height: 160,
                margin: { t: 5, b: 30, l: 40, r: 10 },
                xaxis: { title: { text: 'Position', font: { size: 10 } }, tickfont: { size: 9 } },
                yaxis: { title: { text: 'Score', font: { size: 10 } }, tickfont: { size: 9 }, range: [0, 1] },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                bargap: 0,
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-3 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-800 text-sm">Interactive MSA Viewer</h3>
            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
              {sequences.length} seqs × {conservation.length} pos
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search motif..."
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-36 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {searchResults.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                  {searchResults.length}
                </span>
              )}
            </div>

            {/* Color mode */}
            <select
              value={colorMode}
              onChange={e => setColorMode(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="property">By Property</option>
              <option value="conservation">By Conservation</option>
              <option value="identity">By Identity</option>
            </select>

            {/* Toggle buttons */}
            <button onClick={() => setShowConservation(!showConservation)}
              className={`p-1.5 rounded-lg text-xs ${showConservation ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
              title="Toggle conservation bar">
              <BarChart3 size={14} />
            </button>
            <button onClick={() => setShowConsensus(!showConsensus)}
              className={`p-1.5 rounded-lg text-xs ${showConsensus ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
              title="Toggle consensus row">
              {showConsensus ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>

            {/* Zoom */}
            <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-1">
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                className="p-1 hover:bg-gray-100 rounded" title="Zoom out">
                <ZoomOut size={14} />
              </button>
              <span className="text-[10px] text-gray-500 min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                className="p-1 hover:bg-gray-100 rounded" title="Zoom in">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => setZoom(1)}
                className="p-1 hover:bg-gray-100 rounded" title="Reset zoom">
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="px-3 py-2 border-b bg-gray-50/50 flex flex-wrap gap-2 text-xs">
          {Object.entries(AA_GROUPS).map(([name, { color, bg }]) => (
            <span key={name} className="px-2 py-1 rounded font-medium" style={{ background: bg, color }}>{name}</span>
          ))}
        </div>

        {/* Canvas viewport */}
        <div ref={containerRef} className="overflow-auto" style={{ maxHeight: '600px', maxWidth: '100%' }}
          onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredCell(null)}>
          <canvas ref={canvasRef} className="cursor-crosshair" />
        </div>

        {/* Tooltip */}
        {hoveredCell && sequences[hoveredCell.row] && (
          <div className="px-3 py-2 border-t bg-gray-50 flex items-center gap-4 text-xs text-gray-600">
            <span><strong>Seq:</strong> {sequences[hoveredCell.row].id}</span>
            <span><strong>Pos:</strong> {hoveredCell.col + 1}</span>
            <span><strong>Residue:</strong> {sequences[hoveredCell.row].seq[hoveredCell.col]?.toUpperCase()}</span>
            {conservation[hoveredCell.col] && (
              <>
                <span><strong>Conservation:</strong> {(conservation[hoveredCell.col].score * 100).toFixed(1)}%</span>
                <span><strong>Consensus:</strong> {conservation[hoveredCell.col].consensus}</span>
              </>
            )}
          </div>
        )}
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
