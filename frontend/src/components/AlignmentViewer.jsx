import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Search, BarChart3, Eye, EyeOff, Download, ArrowUpDown, Filter, Layers, Activity, Hash, Grid3X3, Crosshair, FileText } from 'lucide-react'
import Plot from 'react-plotly.js'
import InlineAIInsight from './InlineAIInsight'

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

export default function AlignmentViewer({ alignmentData, conservationData, experimentId }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [showConservation, setShowConservation] = useState(true)
  const [showConsensus, setShowConsensus] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [hoveredCell, setHoveredCell] = useState(null)
  const [colorMode, setColorMode] = useState('property')
  const [sortMode, setSortMode] = useState('original')
  const [showEntropy, setShowEntropy] = useState(true)
  const [showGapMap, setShowGapMap] = useState(true)
  const [highlightConserved, setHighlightConserved] = useState(false)
  const [conservedThreshold, setConservedThreshold] = useState(0.8)
  const [showAAFreq, setShowAAFreq] = useState(true)
  const [showIdentityMatrix, setShowIdentityMatrix] = useState(true)
  const [selectedRegion, setSelectedRegion] = useState(null)
  const [regionStart, setRegionStart] = useState(null)
  const [hoverColumn, setHoverColumn] = useState(null)

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

  // Shannon entropy per position
  const entropy = useMemo(() => {
    if (sequences.length === 0) return []
    const alnLen = Math.max(...sequences.map(s => s.seq.length))
    const result = []
    for (let col = 0; col < alnLen; col++) {
      const column = sequences.map(s => (s.seq[col] || '-').toUpperCase())
      const counts = {}
      column.forEach(c => { counts[c] = (counts[c] || 0) + 1 })
      let h = 0
      const n = column.length
      Object.values(counts).forEach(count => {
        const p = count / n
        if (p > 0) h -= p * Math.log2(p)
      })
      result.push({ position: col + 1, entropy: Math.round(h * 1000) / 1000 })
    }
    return result
  }, [sequences])

  // Per-sequence stats
  const seqStats = useMemo(() => {
    if (sequences.length === 0) return []
    return sequences.map(s => {
      const seq = s.seq.toUpperCase()
      const gaps = (seq.match(/-/g) || []).length
      const realLen = seq.length - gaps
      let matches = 0
      for (let i = 0; i < seq.length; i++) {
        if (conservation[i] && seq[i] === conservation[i].consensus && seq[i] !== '-') matches++
      }
      const identity = conservation.length > 0 ? matches / conservation.length : 0
      return { id: s.id, realLen, gaps, gapPct: (gaps / seq.length * 100), identity: (identity * 100) }
    })
  }, [sequences, conservation])

  // Sorted sequences
  const sortedIndices = useMemo(() => {
    const indices = sequences.map((_, i) => i)
    if (sortMode === 'name') indices.sort((a, b) => sequences[a].id.localeCompare(sequences[b].id))
    else if (sortMode === 'length') indices.sort((a, b) => seqStats[b].realLen - seqStats[a].realLen)
    else if (sortMode === 'similarity') indices.sort((a, b) => seqStats[b].identity - seqStats[a].identity)
    else if (sortMode === 'gaps') indices.sort((a, b) => seqStats[a].gapPct - seqStats[b].gapPct)
    return indices
  }, [sequences, sortMode, seqStats])

  // Conserved regions (blocks of high conservation)
  const conservedRegions = useMemo(() => {
    if (conservation.length === 0) return []
    const regions = []
    let start = null
    for (let i = 0; i < conservation.length; i++) {
      if (conservation[i].score >= conservedThreshold) {
        if (start === null) start = i
      } else {
        if (start !== null && (i - start) >= 3) {
          regions.push({ start: start + 1, end: i, length: i - start, avgScore: conservation.slice(start, i).reduce((s, c) => s + c.score, 0) / (i - start) })
        }
        start = null
      }
    }
    if (start !== null && (conservation.length - start) >= 3) {
      regions.push({ start: start + 1, end: conservation.length, length: conservation.length - start, avgScore: conservation.slice(start).reduce((s, c) => s + c.score, 0) / (conservation.length - start) })
    }
    return regions.sort((a, b) => b.length - a.length)
  }, [conservation, conservedThreshold])

  // AA frequency across entire alignment
  const aaFrequency = useMemo(() => {
    const counts = {}
    let total = 0
    sequences.forEach(s => {
      for (const ch of s.seq.toUpperCase()) {
        if (ch !== '-') { counts[ch] = (counts[ch] || 0) + 1; total++ }
      }
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([aa, count]) => ({ aa, count, freq: count / total }))
  }, [sequences])

  // Pairwise identity matrix (on demand, max 50 seqs)
  const identityMatrix = useMemo(() => {
    if (!showIdentityMatrix || sequences.length === 0 || sequences.length > 50) return null
    const n = sequences.length
    const matrix = Array.from({ length: n }, () => Array(n).fill(0))
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        if (i === j) { matrix[i][j] = 100; continue }
        let matches = 0, compared = 0
        const s1 = sequences[i].seq.toUpperCase(), s2 = sequences[j].seq.toUpperCase()
        const len = Math.min(s1.length, s2.length)
        for (let k = 0; k < len; k++) {
          if (s1[k] !== '-' && s2[k] !== '-') { compared++; if (s1[k] === s2[k]) matches++ }
        }
        const pct = compared > 0 ? (matches / compared * 100) : 0
        matrix[i][j] = Math.round(pct * 10) / 10
        matrix[j][i] = matrix[i][j]
      }
    }
    return matrix
  }, [sequences, showIdentityMatrix])

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

    // Sequences (sorted)
    sortedIndices.forEach((origIdx, row) => {
      const entry = sequences[origIdx]
      const y = yOffset + row * charH
      const isSearchHit = searchResults.some(r => r.seqIdx === origIdx)

      ctx.fillStyle = isSearchHit ? '#1d4ed8' : '#1f2937'
      ctx.font = `${isSearchHit ? 'bold ' : ''}${Math.max(8, 10 * zoom)}px monospace`
      const maxLabelChars = Math.floor(labelW / (6 * zoom))
      const label = entry.id.length > maxLabelChars ? entry.id.slice(0, maxLabelChars) + '…' : entry.id
      ctx.fillText(label, 4, y + charH - 4)

      for (let col = 0; col < entry.seq.length; col++) {
        const aa = entry.seq[col].toUpperCase()
        const x = labelW + col * charW
        const inSearch = searchResults.some(r => r.seqIdx === origIdx && col >= r.start && col <= r.end)
        const inConservedBlock = highlightConserved && conservation[col] && conservation[col].score >= conservedThreshold
        const inSelectedRegion = selectedRegion && col >= selectedRegion.start && col <= selectedRegion.end

        let bgColor, alpha
        if (colorMode === 'conservation') {
          const c = conservation[col]
          if (c) {
            const hue = c.score > 0.8 ? 142 : c.score > 0.5 ? 45 : 0
            bgColor = `hsl(${hue}, ${Math.round(c.score * 80)}%, 65%)`
            alpha = 0.3 + c.score * 0.4
          } else { bgColor = '#f5f5f5'; alpha = 0.2 }
        } else if (colorMode === 'identity') {
          const c = conservation[col]
          if (c && aa === c.consensus && aa !== '-') { bgColor = '#22c55e'; alpha = 0.35 }
          else if (aa === '-') { bgColor = '#e5e7eb'; alpha = 0.3 }
          else { bgColor = '#fbbf24'; alpha = 0.2 }
        } else if (colorMode === 'hydrophobicity') {
          const hydro = 'AVLIMFWP', charged = 'KRHDE'
          if (hydro.includes(aa)) { bgColor = '#f97316'; alpha = 0.4 }
          else if (charged.includes(aa)) { bgColor = '#06b6d4'; alpha = 0.4 }
          else if (aa === '-') { bgColor = '#e5e7eb'; alpha = 0.3 }
          else { bgColor = '#a3a3a3'; alpha = 0.2 }
        } else {
          bgColor = AA_COLORS[aa] || '#f5f5f5'; alpha = 0.35
        }

        if (inConservedBlock) { bgColor = '#22c55e'; alpha = Math.max(alpha, 0.5) }
        if (inSelectedRegion) { alpha = Math.max(alpha, 0.6) }

        ctx.fillStyle = bgColor
        ctx.globalAlpha = inSearch ? 0.8 : alpha
        ctx.fillRect(x, y, charW, charH)
        ctx.globalAlpha = 1.0

        if (inSearch) { ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.strokeRect(x, y, charW, charH) }
        if (inSelectedRegion) { ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 1; ctx.strokeRect(x, y, charW, charH) }
        if (hoveredCell && hoveredCell.row === row && hoveredCell.col === col) {
          ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.strokeRect(x, y, charW, charH)
        }

        ctx.fillStyle = inSearch ? '#92400e' : (AA_COLORS[aa] ? '#1a1a2e' : '#9ca3af')
        ctx.font = `${Math.max(8, 11 * zoom)}px monospace`
        if (charW >= 7) ctx.fillText(aa, x + 1, y + charH - 4)
      }
    })

    // Position ruler
    if (charW >= 6) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = `${Math.max(7, 8 * zoom)}px monospace`
      for (let col = 9; col < conservation.length; col += 10) {
        const x = labelW + col * charW
        ctx.fillText(`${col + 1}`, x - 4, yOffset - 2)
      }
    }

    // Vertical column highlight on hover
    if (hoverColumn !== null && hoverColumn >= 0 && hoverColumn < conservation.length) {
      const hx = labelW + hoverColumn * charW
      ctx.fillStyle = 'rgba(99, 102, 241, 0.12)'
      ctx.fillRect(hx, 0, charW, canvas.height)
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'
      ctx.lineWidth = 1
      ctx.strokeRect(hx, 0, charW, canvas.height)
    }
  }, [sequences, conservation, consensusSeq, zoom, showConservation, showConsensus, colorMode, searchResults, hoveredCell, charW, charH, labelW, consHeight, consensusH, sortedIndices, highlightConserved, conservedThreshold, selectedRegion, hoverColumn])

  // Mouse tracking
  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const yOff = (showConservation ? 60 : 0) + (showConsensus ? charH : 0)
    if (x < labelW || y < yOff) { setHoveredCell(null); setHoverColumn(null); return }
    const col = Math.floor((x - labelW) / charW)
    const row = Math.floor((y - yOff) / charH)
    setHoverColumn(col >= 0 && col < conservation.length ? col : null)
    if (row >= 0 && row < sequences.length && col >= 0) {
      setHoveredCell({ row, col })
    } else {
      setHoveredCell(null)
    }
  }, [sequences, charW, charH, labelW, showConservation, showConsensus, conservation.length])

  // Region selection via canvas clicks
  const handleCanvasClick = useCallback((e) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const yOff = (showConservation ? 60 : 0) + (showConsensus ? charH : 0)
    if (x < labelW) return
    const col = Math.floor((x - labelW) / charW)
    if (col < 0 || col >= conservation.length) return
    if (regionStart === null) {
      setRegionStart(col)
      setSelectedRegion(null)
    } else {
      const start = Math.min(regionStart, col)
      const end = Math.max(regionStart, col)
      setSelectedRegion({ start, end })
      setRegionStart(null)
    }
  }, [charW, labelW, showConservation, showConsensus, charH, regionStart, conservation.length])

  const regionStats = useMemo(() => {
    if (!selectedRegion || conservation.length === 0) return null
    const { start, end } = selectedRegion
    const slice = conservation.slice(start, end + 1)
    const avgCons = slice.reduce((s, c) => s + c.score, 0) / slice.length
    const avgGap = slice.reduce((s, c) => s + (c.gapFrac || 0), 0) / slice.length
    const entSlice = entropy.slice(start, end + 1)
    const avgEnt = entSlice.reduce((s, e) => s + e.entropy, 0) / entSlice.length
    return {
      length: end - start + 1, startPos: start + 1, endPos: end + 1,
      avgConservation: (avgCons * 100).toFixed(1),
      avgGapPct: (avgGap * 100).toFixed(1),
      avgEntropy: avgEnt.toFixed(2),
      consensus: conservation.slice(start, end + 1).map(c => c.consensus).join(''),
    }
  }, [selectedRegion, conservation, entropy])

  // Summary stats
  const stats = useMemo(() => {
    if (!sequences.length) return null
    const alnLen = Math.max(...sequences.map(s => s.seq.length))
    const totalCells = sequences.length * alnLen
    const gaps = sequences.reduce((sum, s) => sum + (s.seq.match(/-/g) || []).length, 0)
    const avgConservation = conservation.length > 0
      ? conservation.reduce((s, c) => s + c.score, 0) / conservation.length : 0
    const avgEntropy = entropy.length > 0
      ? entropy.reduce((s, e) => s + e.entropy, 0) / entropy.length : 0
    const maxCons = conservation.length > 0 ? Math.max(...conservation.map(c => c.score)) : 0
    const minCons = conservation.length > 0 ? Math.min(...conservation.map(c => c.score)) : 0
    return {
      numSeqs: sequences.length, alnLen,
      gapPct: ((gaps / totalCells) * 100).toFixed(1),
      avgCons: (avgConservation * 100).toFixed(1),
      avgEntropy: avgEntropy.toFixed(2),
      conservedBlocks: conservedRegions.length,
      maxCons: (maxCons * 100).toFixed(1),
      minCons: (minCons * 100).toFixed(1),
    }
  }, [sequences, conservation, entropy, conservedRegions])

  // Export alignment analysis as CSV
  const exportCSV = useCallback(() => {
    if (!sequences.length) return
    let csv = 'Sequence ID,Length (no gaps),Gap Count,Gap %,Identity %\n'
    seqStats.forEach(s => {
      csv += `${s.id},${s.realLen},${s.gaps},${s.gapPct.toFixed(1)},${s.identity.toFixed(1)}\n`
    })
    csv += '\nPosition,Conservation Score,Consensus,Shannon Entropy\n'
    conservation.forEach((c, i) => {
      csv += `${c.position},${c.score.toFixed(4)},${c.consensus},${entropy[i]?.entropy.toFixed(3) || ''}\n`
    })
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'alignment_analysis.csv'; a.click()
    URL.revokeObjectURL(url)
  }, [sequences, conservation, entropy, seqStats])

  if (!alignmentData) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
        No alignment data available yet
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Enhanced Stats bar - 8 metrics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label: 'Sequences', value: stats.numSeqs, color: 'blue' },
            { label: 'Alignment Length', value: stats.alnLen, color: 'purple' },
            { label: 'Gap %', value: `${stats.gapPct}%`, color: 'amber' },
            { label: 'Avg Conservation', value: `${stats.avgCons}%`, color: 'emerald' },
            { label: 'Shannon Entropy', value: stats.avgEntropy, color: 'cyan' },
            { label: 'Conserved Blocks', value: stats.conservedBlocks, color: 'green' },
            { label: 'Max Conservation', value: `${stats.maxCons}%`, color: 'teal' },
            { label: 'Min Conservation', value: `${stats.minCons}%`, color: 'rose' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`bg-${color}-50 border border-${color}-200 rounded-xl p-2.5`}>
              <p className={`text-[9px] text-${color}-400 uppercase tracking-wider font-medium`}>{label}</p>
              <p className={`text-base font-bold text-${color}-800`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Conservation plot (Plotly) with threshold line */}
      {showConservation && conservation.length > 0 && conservation.length <= 2000 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <BarChart3 size={14} className="text-emerald-500" /> Conservation Score per Position
              {conservedRegions.length > 0 && (
                <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">
                  {conservedRegions.length} conserved blocks found
                </span>
              )}
            </h4>
          </div>
          <div className="p-2">
            <Plot
              data={[
                {
                  x: conservation.map(c => c.position),
                  y: conservation.map(c => c.score),
                  type: 'bar',
                  name: 'Conservation',
                  marker: {
                    color: conservation.map(c =>
                      c.score > 0.8 ? '#22c55e' : c.score > 0.5 ? '#eab308' : '#ef4444'
                    ),
                  },
                  hovertemplate: 'Pos %{x}<br>Score: %{y:.3f}<br>Consensus: %{text}<extra></extra>',
                  text: conservation.map(c => c.consensus),
                },
                {
                  x: [1, conservation.length],
                  y: [conservedThreshold, conservedThreshold],
                  type: 'scatter', mode: 'lines',
                  name: `Threshold (${conservedThreshold})`,
                  line: { color: '#6366f1', width: 1.5, dash: 'dash' },
                  hoverinfo: 'skip',
                },
              ]}
              layout={{
                height: 160,
                margin: { t: 5, b: 30, l: 40, r: 10 },
                xaxis: { title: { text: 'Position', font: { size: 10 } }, tickfont: { size: 9 } },
                yaxis: { title: { text: 'Score', font: { size: 10 } }, tickfont: { size: 9 }, range: [0, 1] },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                bargap: 0, showlegend: false,
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* Toolbar + MSA Canvas (moved up, right after conservation) */}
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-3 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-800 text-sm">Interactive MSA Viewer</h3>
            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
              {sequences.length} seqs × {conservation.length} pos
            </span>
            {regionStart !== null && (
              <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-medium animate-pulse">
                Click to end region (start: {regionStart + 1})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search motif..."
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-36 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              {searchResults.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                  {searchResults.length}
                </span>
              )}
            </div>

            {/* Color mode */}
            <select value={colorMode} onChange={e => setColorMode(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="property">By Property</option>
              <option value="conservation">By Conservation</option>
              <option value="identity">By Identity</option>
              <option value="hydrophobicity">By Hydrophobicity</option>
            </select>

            {/* Sort mode */}
            <select value={sortMode} onChange={e => setSortMode(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
              title="Sort sequences">
              <option value="original">Original Order</option>
              <option value="name">Sort by Name</option>
              <option value="length">Sort by Length</option>
              <option value="similarity">Sort by Similarity</option>
              <option value="gaps">Sort by Gaps</option>
            </select>

            {/* Toggle buttons */}
            <div className="flex items-center gap-1">
              <button onClick={() => setShowConservation(!showConservation)}
                className={`p-1.5 rounded-lg text-xs ${showConservation ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
                title="Toggle conservation bar"><BarChart3 size={14} /></button>
              <button onClick={() => setShowConsensus(!showConsensus)}
                className={`p-1.5 rounded-lg text-xs ${showConsensus ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
                title="Toggle consensus row">{showConsensus ? <Eye size={14} /> : <EyeOff size={14} />}</button>
              <button onClick={() => setHighlightConserved(!highlightConserved)}
                className={`p-1.5 rounded-lg text-xs ${highlightConserved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                title="Highlight conserved regions"><Crosshair size={14} /></button>
            </div>

            {/* Zoom */}
            <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-1">
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1 hover:bg-gray-100 rounded" title="Zoom out"><ZoomOut size={14} /></button>
              <span className="text-[10px] text-gray-500 min-w-[32px] text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="p-1 hover:bg-gray-100 rounded" title="Zoom in"><ZoomIn size={14} /></button>
              <button onClick={() => setZoom(1)} className="p-1 hover:bg-gray-100 rounded" title="Reset zoom"><Maximize2 size={14} /></button>
            </div>

            {/* Export CSV */}
            <button onClick={exportCSV}
              className="p-1.5 rounded-lg text-xs bg-gray-100 text-gray-600 hover:bg-gray-200" title="Export analysis CSV">
              <Download size={14} />
            </button>
          </div>
        </div>

        {/* Conserved threshold slider */}
        {highlightConserved && (
          <div className="px-3 py-2 border-b bg-green-50/50 flex items-center gap-3">
            <span className="text-xs text-green-700 font-medium">Conserved threshold:</span>
            <input type="range" min="0.5" max="1.0" step="0.05" value={conservedThreshold}
              onChange={e => setConservedThreshold(parseFloat(e.target.value))}
              className="w-32 h-1.5 accent-green-500" />
            <span className="text-xs text-green-800 font-bold">{(conservedThreshold * 100).toFixed(0)}%</span>
            <span className="text-[10px] text-green-600">({conservedRegions.length} blocks, longest: {conservedRegions[0]?.length || 0} pos)</span>
          </div>
        )}

        {/* Legend */}
        <div className="px-3 py-2 border-b bg-gray-50/50 flex flex-wrap gap-2 text-xs">
          {Object.entries(AA_GROUPS).map(([name, { color, bg }]) => (
            <span key={name} className="px-2 py-1 rounded font-medium" style={{ background: bg, color }}>{name}</span>
          ))}
          <span className="ml-auto text-gray-400 text-[10px]">Click canvas to select region</span>
        </div>

        {/* Canvas viewport */}
        <div ref={containerRef} className="overflow-auto" style={{ maxHeight: '600px', maxWidth: '100%' }}
          onMouseMove={handleMouseMove} onMouseLeave={() => { setHoveredCell(null); setHoverColumn(null) }}>
          <canvas ref={canvasRef} className="cursor-crosshair" onClick={handleCanvasClick} />
        </div>

        {/* Enhanced tooltip with entropy + identity + column info */}
        {hoveredCell && sequences[sortedIndices[hoveredCell.row]] && (() => {
          const origIdx = sortedIndices[hoveredCell.row]
          const s = sequences[origIdx]
          return (
            <div className="px-3 py-2 border-t bg-gray-50 flex items-center gap-4 text-xs text-gray-600 flex-wrap">
              <span><strong>Seq:</strong> {s.id}</span>
              <span><strong>Pos:</strong> {hoveredCell.col + 1}</span>
              <span><strong>Residue:</strong> {s.seq[hoveredCell.col]?.toUpperCase()}</span>
              {conservation[hoveredCell.col] && (
                <>
                  <span><strong>Conservation:</strong> {(conservation[hoveredCell.col].score * 100).toFixed(1)}%</span>
                  <span><strong>Consensus:</strong> {conservation[hoveredCell.col].consensus}</span>
                  <span><strong>Gap %:</strong> {((conservation[hoveredCell.col].gapFrac || 0) * 100).toFixed(1)}%</span>
                </>
              )}
              {entropy[hoveredCell.col] && (
                <span><strong>Entropy:</strong> {entropy[hoveredCell.col].entropy.toFixed(3)} bits</span>
              )}
              {seqStats[origIdx] && (
                <span><strong>Seq Identity:</strong> {seqStats[origIdx].identity.toFixed(1)}%</span>
              )}
            </div>
          )
        })()}

        {/* Region selection stats */}
        {regionStats && (
          <div className="px-4 py-3 border-t bg-violet-50 text-xs space-y-2">
            <div className="flex items-center gap-2 text-violet-700 font-semibold">
              <Filter size={14} />
              Selected Region: Position {regionStats.startPos} – {regionStats.endPos} ({regionStats.length} positions)
              <button onClick={() => { setSelectedRegion(null); setRegionStart(null) }}
                className="ml-auto text-[10px] bg-violet-200 text-violet-700 px-2 py-0.5 rounded hover:bg-violet-300">Clear</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-white rounded-lg p-2 border border-violet-100">
                <p className="text-[9px] text-violet-400 uppercase">Avg Conservation</p>
                <p className="text-sm font-bold text-violet-800">{regionStats.avgConservation}%</p>
              </div>
              <div className="bg-white rounded-lg p-2 border border-violet-100">
                <p className="text-[9px] text-violet-400 uppercase">Avg Gap %</p>
                <p className="text-sm font-bold text-violet-800">{regionStats.avgGapPct}%</p>
              </div>
              <div className="bg-white rounded-lg p-2 border border-violet-100">
                <p className="text-[9px] text-violet-400 uppercase">Avg Entropy</p>
                <p className="text-sm font-bold text-violet-800">{regionStats.avgEntropy} bits</p>
              </div>
              <div className="bg-white rounded-lg p-2 border border-violet-100">
                <p className="text-[9px] text-violet-400 uppercase">Consensus</p>
                <p className="text-sm font-bold text-violet-800 font-mono truncate" title={regionStats.consensus}>
                  {regionStats.consensus.length > 20 ? regionStats.consensus.slice(0, 20) + '…' : regionStats.consensus}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inline AI Analysis - Alignment Overview */}
      {experimentId && (
        <InlineAIInsight experimentId={experimentId} scope="alignment_auto" title="AI Alignment Analysis" />
      )}

      {/* Shannon Entropy plot (always visible) */}
      {entropy.length > 0 && entropy.length <= 2000 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Activity size={14} className="text-cyan-500" /> Shannon Entropy per Position
              <span className="text-[10px] text-gray-400">(higher = more variable)</span>
            </h4>
          </div>
          <div className="p-2">
            <Plot
              data={[{
                x: entropy.map(e => e.position), y: entropy.map(e => e.entropy),
                type: 'scatter', mode: 'lines', fill: 'tozeroy',
                line: { color: '#06b6d4', width: 1 }, fillcolor: 'rgba(6,182,212,0.15)',
                hovertemplate: 'Pos %{x}<br>Entropy: %{y:.3f} bits<extra></extra>',
              }]}
              layout={{
                height: 140, margin: { t: 5, b: 30, l: 40, r: 10 },
                xaxis: { title: { text: 'Position', font: { size: 10 } }, tickfont: { size: 9 } },
                yaxis: { title: { text: 'Entropy (bits)', font: { size: 10 } }, tickfont: { size: 9 } },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* Inline AI - Entropy Analysis */}
      {experimentId && (
        <InlineAIInsight experimentId={experimentId} scope="chart_entropy" title="AI Entropy Analysis" />
      )}

      {/* Gap Distribution Heatmap (always visible) */}
      {conservation.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Grid3X3 size={14} className="text-rose-500" /> Gap Distribution Map
            </h4>
          </div>
          <div className="p-2">
            <Plot
              data={[{
                z: sortedIndices.map(idx => {
                  const s = sequences[idx].seq
                  const row = []
                  for (let i = 0; i < s.length; i++) row.push(s[i] === '-' ? 1 : 0)
                  return row
                }),
                y: sortedIndices.map(idx => sequences[idx].id.slice(0, 15)),
                type: 'heatmap', colorscale: [[0, '#f0fdf4'], [1, '#ef4444']],
                showscale: false,
                hovertemplate: '%{y}<br>Pos: %{x}<br>%{z:d}<extra></extra>',
              }]}
              layout={{
                height: Math.min(400, Math.max(150, sequences.length * 16)),
                margin: { t: 5, b: 30, l: 120, r: 10 },
                xaxis: { title: { text: 'Position', font: { size: 10 } } },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* AA Frequency Distribution (always visible) */}
      {aaFrequency.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Hash size={14} className="text-indigo-500" /> Amino Acid Frequency Distribution
            </h4>
          </div>
          <div className="p-2">
            <Plot
              data={[{
                x: aaFrequency.map(a => a.aa), y: aaFrequency.map(a => a.freq * 100),
                type: 'bar',
                marker: { color: aaFrequency.map(a => AA_COLORS[a.aa] || '#9ca3af'), opacity: 0.8 },
                text: aaFrequency.map(a => `${(a.freq * 100).toFixed(1)}%`),
                textposition: 'outside', textfont: { size: 9 },
                hovertemplate: '%{x}: %{y:.2f}% (n=%{customdata})<extra></extra>',
                customdata: aaFrequency.map(a => a.count),
              }]}
              layout={{
                height: 220, margin: { t: 10, b: 40, l: 45, r: 10 },
                xaxis: { title: { text: 'Amino Acid', font: { size: 10 } } },
                yaxis: { title: { text: 'Frequency (%)', font: { size: 10 } } },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* Pairwise Identity Matrix (always visible, max 50 seqs) */}
      {identityMatrix && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Layers size={14} className="text-violet-500" /> Pairwise Sequence Identity Matrix (%)
            </h4>
          </div>
          <div className="p-2">
            <Plot
              data={[{
                z: identityMatrix,
                x: sequences.map(s => s.id.slice(0, 12)),
                y: sequences.map(s => s.id.slice(0, 12)),
                type: 'heatmap', colorscale: 'YlGnBu',
                hovertemplate: '%{y} vs %{x}<br>Identity: %{z:.1f}%<extra></extra>',
                colorbar: { title: '% Identity', titlefont: { size: 10 } },
              }]}
              layout={{
                height: Math.max(400, sequences.length * 25),
                margin: { t: 10, b: 100, l: 100, r: 20 },
                paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* Conserved Regions Table */}
      {highlightConserved && conservedRegions.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-green-50/50">
            <h4 className="text-sm font-semibold text-green-700 flex items-center gap-2">
              <Crosshair size={14} /> Conserved Regions ({conservedRegions.length} blocks ≥ {(conservedThreshold * 100).toFixed(0)}%)
            </h4>
          </div>
          <div className="overflow-auto max-h-48">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">#</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Start</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">End</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Length</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Avg Score</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {conservedRegions.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-green-50/50">
                    <td className="px-3 py-1.5 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono">{r.start}</td>
                    <td className="px-3 py-1.5 font-mono">{r.end}</td>
                    <td className="px-3 py-1.5 font-bold">{r.length}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${r.avgScore > 0.9 ? 'bg-green-100 text-green-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {(r.avgScore * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <button onClick={() => setSelectedRegion({ start: r.start - 1, end: r.end - 1 })}
                        className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded hover:bg-green-200">Select</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Sequence Statistics Table */}
      {seqStats.length > 0 && (
        <details className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2">
            <FileText size={14} className="text-slate-500" />
            Per-Sequence Statistics ({seqStats.length} sequences)
          </summary>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Sequence ID</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Length (aa)</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Gaps</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Gap %</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Identity %</th>
                </tr>
              </thead>
              <tbody>
                {seqStats.map((s, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono text-gray-700">{s.id}</td>
                    <td className="px-3 py-1.5 text-right">{s.realLen}</td>
                    <td className="px-3 py-1.5 text-right">{s.gaps}</td>
                    <td className="px-3 py-1.5 text-right">{s.gapPct.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        s.identity > 80 ? 'bg-green-100 text-green-700' :
                        s.identity > 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                      }`}>{s.identity.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
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
