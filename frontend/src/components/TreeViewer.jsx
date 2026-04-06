import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Download, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff } from 'lucide-react'

// ── Color palette ────────────────────────────────────────────
const PALETTE = [
  '#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ef4444',
  '#ec4899','#06b6d4','#f97316','#6366f1','#14b8a6',
  '#e11d48','#84cc16','#a855f7','#f43f5e','#22d3ee',
]

// ── Newick parser ────────────────────────────────────────────
let _nodeId = 0
function parseNewick(str) {
  _nodeId = 0
  const s = str.trim().replace(/;$/, '')
  let i = 0
  function readNode() {
    const node = { id: _nodeId++, children: [], name: '', length: 0 }
    if (s[i] === '(') {
      i++
      node.children.push(readNode())
      while (s[i] === ',') { i++; node.children.push(readNode()) }
      i++
    }
    let name = ''
    while (i < s.length && ![':',',',')','(', ';'].includes(s[i])) name += s[i++]
    node.name = name.trim()
    if (s[i] === ':') {
      i++
      let len = ''
      while (i < s.length && ![',',')',';','('].includes(s[i])) len += s[i++]
      node.length = parseFloat(len) || 0
    }
    return node
  }
  return readNode()
}

// ── Tree metrics ─────────────────────────────────────────────
function countLeaves(n) {
  if (n.children.length === 0) return 1
  return n.children.reduce((s, c) => s + countLeaves(c), 0)
}
function countDescendants(n) {
  if (n.children.length === 0) return 0
  return n.children.reduce((s, c) => s + 1 + countDescendants(c), 0)
}
function maxDepth(n, d = 0) {
  if (n.children.length === 0) return d + n.length
  return Math.max(...n.children.map(c => maxDepth(c, d + n.length)))
}

// ── Layout: Rectangular ──────────────────────────────────────
function layoutRectangular(root) {
  const md = maxDepth(root)
  let leafIdx = 0
  function walk(node, depth) {
    node._depth = depth
    if (node.children.length === 0) {
      node._y = leafIdx++
      node._x = depth
    } else {
      node.children.forEach(c => walk(c, depth + node.length))
      const ys = node.children.map(c => c._y)
      node._y = (Math.min(...ys) + Math.max(...ys)) / 2
      node._x = depth
    }
  }
  walk(root, 0)
  return { leafCount: leafIdx, maxDepth: md }
}

// ── Layout: Radial ───────────────────────────────────────────
function layoutRadial(root) {
  const lc = countLeaves(root)
  const md = maxDepth(root)
  let leafIdx = 0
  function walk(node, depth) {
    node._depth = depth
    node._radius = depth
    if (node.children.length === 0) {
      node._angle = (leafIdx / lc) * 2 * Math.PI
      leafIdx++
    } else {
      node.children.forEach(c => walk(c, depth + node.length))
      const angles = node.children.map(c => c._angle)
      node._angle = (Math.min(...angles) + Math.max(...angles)) / 2
    }
  }
  walk(root, 0)
  return { leafCount: lc, maxDepth: md }
}

// ── Layout: Unrooted (equal-angle) ──────────────────────────
function layoutUnrooted(root) {
  const lc = countLeaves(root)
  const md = maxDepth(root)
  function walk(node, x, y, angleStart, angleEnd, depth) {
    node._ux = x
    node._uy = y
    node._depth = depth
    if (node.children.length === 0) return
    let cumLeaves = 0
    const total = countLeaves(node)
    node.children.forEach(child => {
      const childLeaves = countLeaves(child)
      const aStart = angleStart + (cumLeaves / total) * (angleEnd - angleStart)
      const aEnd = angleStart + ((cumLeaves + childLeaves) / total) * (angleEnd - angleStart)
      const aMid = (aStart + aEnd) / 2
      const len = Math.max(child.length, 0.001)
      const cx = x + Math.cos(aMid) * len * 300
      const cy = y + Math.sin(aMid) * len * 300
      walk(child, cx, cy, aStart, aEnd, depth + child.length)
      cumLeaves += childLeaves
    })
  }
  walk(root, 0, 0, 0, 2 * Math.PI, 0)
  return { leafCount: lc, maxDepth: md }
}

// ── Assign clade colors to top-level subtrees ────────────────
function assignCladeColors(root) {
  const map = {}
  if (root.children.length === 0) { map[root.id] = PALETTE[0]; return map }
  function paint(node, color) {
    map[node.id] = color
    node.children.forEach(c => paint(c, color))
  }
  root.children.forEach((child, i) => paint(child, PALETTE[i % PALETTE.length]))
  map[root.id] = '#94a3b8'
  return map
}

// ── Collect all nodes flat ───────────────────────────────────
function flattenTree(node, parent = null, list = []) {
  list.push({ node, parent })
  node.children.forEach(c => flattenTree(c, node, list))
  return list
}

// ── Collect clade ids ────────────────────────────────────────
function cladeIds(node) {
  const ids = [node.id]
  node.children.forEach(c => cladeIds(c).forEach(id => ids.push(id)))
  return ids
}

// ── Export helpers ────────────────────────────────────────────
function exportSVG(svgEl, filename) {
  const data = new XMLSerializer().serializeToString(svgEl)
  const blob = new Blob([data], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
function exportPNG(svgEl, filename, scale = 2) {
  const data = new XMLSerializer().serializeToString(svgEl)
  const img = new Image()
  const canvas = document.createElement('canvas')
  img.onload = () => {
    canvas.width = svgEl.clientWidth * scale
    canvas.height = svgEl.clientHeight * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    })
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)))
}

// ── Main component ───────────────────────────────────────────
export default function TreeViewer({ newick }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const [mode, setMode] = useState('rectangular')
  const [showLengths, setShowLengths] = useState(false)
  const [width, setWidth] = useState(800)
  const [hovered, setHovered] = useState(null)
  const [highlightClade, setHighlightClade] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  // Responsive width
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // Reset view on mode change
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); setHighlightClade(null) }, [mode])

  // Parse & layout
  const treeData = useMemo(() => {
    if (!newick) return null
    const root = parseNewick(newick)
    let layout
    if (mode === 'radial') layout = layoutRadial(root)
    else if (mode === 'unrooted') layout = layoutUnrooted(root)
    else layout = layoutRectangular(root)
    const colors = assignCladeColors(root)
    const flat = flattenTree(root)
    return { root, ...layout, colors, flat }
  }, [newick, mode])

  const highlightedIds = useMemo(() => {
    if (!highlightClade || !treeData) return new Set()
    const target = treeData.flat.find(f => f.node.id === highlightClade)
    return target ? new Set(cladeIds(target.node)) : new Set()
  }, [highlightClade, treeData])

  // Pan/zoom handlers
  const onWheel = useCallback(e => {
    e.preventDefault()
    setZoom(z => Math.max(0.2, Math.min(10, z * (e.deltaY < 0 ? 1.15 : 0.87))))
  }, [])
  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return
    dragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onMouseMove = useCallback(e => {
    if (!dragging.current) return
    setPan(p => ({ x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y }))
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onMouseUp = useCallback(() => { dragging.current = false }, [])

  if (!newick) {
    return <div className="bg-white rounded-xl border p-8 text-center text-gray-400">No tree data available</div>
  }
  if (!treeData) return null

  const { root, leafCount, maxDepth: md, colors, flat } = treeData
  const PAD = { top: 40, bottom: 50, left: 30, right: 180 }
  const height = mode === 'rectangular'
    ? Math.max(450, leafCount * 32) + PAD.top + PAD.bottom
    : Math.max(550, width * 0.75)
  const drawW = width - PAD.left - PAD.right
  const drawH = height - PAD.top - PAD.bottom
  const scaleX = md > 0 ? drawW / md : 1
  const scaleY = leafCount > 1 ? drawH / (leafCount - 1) : drawH / 2

  // Coordinate converters
  function rectXY(node) {
    return { x: PAD.left + node._x * scaleX, y: PAD.top + node._y * scaleY }
  }
  function radialXY(node) {
    const r = md > 0 ? (node._radius / md) * Math.min(drawW, drawH) * 0.42 : 0
    const cx = width / 2, cy = height / 2
    return { x: cx + Math.cos(node._angle) * r, y: cy + Math.sin(node._angle) * r, angle: node._angle }
  }
  function unrootedXY(node) {
    const cx = width / 2, cy = height / 2
    return { x: cx + (node._ux || 0), y: cy + (node._uy || 0) }
  }
  function getXY(node) {
    if (mode === 'radial') return radialXY(node)
    if (mode === 'unrooted') return unrootedXY(node)
    return rectXY(node)
  }

  // Build SVG elements
  const lines = []
  const nodes = []
  const labels = []
  const lengthLabels = []

  flat.forEach(({ node, parent }) => {
    const pos = getXY(node)
    const isLeaf = node.children.length === 0
    const color = colors[node.id] || '#94a3b8'
    const dimmed = highlightedIds.size > 0 && !highlightedIds.has(node.id)
    const opacity = dimmed ? 0.12 : 1

    // Branch from parent
    if (parent) {
      const pp = getXY(parent)
      if (mode === 'rectangular') {
        const mx = PAD.left + (parent._x + parent.length) * scaleX
        lines.push(
          <g key={`br-${node.id}`} opacity={opacity}>
            <line x1={mx} y1={pp.y} x2={mx} y2={pos.y} stroke={color} strokeWidth={2} />
            <line x1={mx} y1={pos.y} x2={pos.x} y2={pos.y} stroke={color} strokeWidth={2} />
          </g>
        )
        if (showLengths && node.length > 0) {
          lengthLabels.push(
            <text key={`bl-${node.id}`} x={(mx + pos.x) / 2} y={pos.y - 6}
              fontSize={9} fill="#9ca3af" textAnchor="middle" opacity={opacity}>
              {node.length.toFixed(4)}
            </text>
          )
        }
      } else {
        lines.push(
          <line key={`br-${node.id}`} x1={pp.x} y1={pp.y} x2={pos.x} y2={pos.y}
            stroke={color} strokeWidth={2} opacity={opacity} />
        )
        if (showLengths && node.length > 0) {
          lengthLabels.push(
            <text key={`bl-${node.id}`} x={(pp.x + pos.x) / 2} y={(pp.y + pos.y) / 2 - 5}
              fontSize={9} fill="#9ca3af" textAnchor="middle" opacity={opacity}>
              {node.length.toFixed(4)}
            </text>
          )
        }
      }
    }

    // Node circle
    const r = isLeaf ? 5 : 4
    nodes.push(
      <circle key={`nd-${node.id}`} cx={pos.x} cy={pos.y} r={r}
        fill={isLeaf ? color : (highlightClade === node.id ? '#1e293b' : '#fff')}
        stroke={color} strokeWidth={isLeaf ? 0 : 2}
        opacity={opacity}
        style={{ cursor: isLeaf ? 'default' : 'pointer', transition: 'fill 0.2s' }}
        onMouseEnter={() => setHovered(node)}
        onMouseLeave={() => setHovered(null)}
        onClick={e => {
          e.stopPropagation()
          if (!isLeaf) setHighlightClade(prev => prev === node.id ? null : node.id)
        }}
      />
    )

    // Leaf label
    if (isLeaf && node.name) {
      if (mode === 'radial') {
        const a = node._angle
        const flip = a > Math.PI / 2 && a < 3 * Math.PI / 2
        labels.push(
          <text key={`lb-${node.id}`} x={pos.x} y={pos.y}
            transform={`rotate(${(a * 180 / Math.PI) + (flip ? 180 : 0)}, ${pos.x}, ${pos.y})`}
            dx={flip ? -10 : 10} dy={4}
            fontSize={12} fill="#1e293b" fontFamily="Inter, system-ui, sans-serif"
            textAnchor={flip ? 'end' : 'start'} opacity={opacity}>
            {node.name}
          </text>
        )
      } else if (mode === 'unrooted') {
        labels.push(
          <text key={`lb-${node.id}`} x={pos.x + 10} y={pos.y + 4}
            fontSize={12} fill="#1e293b" fontFamily="Inter, system-ui, sans-serif"
            opacity={opacity}>
            {node.name}
          </text>
        )
      } else {
        labels.push(
          <text key={`lb-${node.id}`} x={pos.x + 10} y={pos.y + 4}
            fontSize={12} fill="#1e293b" fontFamily="Inter, system-ui, sans-serif"
            opacity={opacity}>
            {node.name}
          </text>
        )
      }
    }
  })

  // Scale bar for rectangular mode
  let scaleBar = null
  if (mode === 'rectangular' && md > 0) {
    const mag = Math.pow(10, Math.floor(Math.log10(md)))
    const barLen = md / mag >= 5 ? mag : mag / 2
    const barPx = barLen * scaleX
    const bx = PAD.left, by = height - 20
    scaleBar = (
      <g>
        <line x1={bx} y1={by} x2={bx + barPx} y2={by} stroke="#6b7280" strokeWidth={1.5} />
        <line x1={bx} y1={by - 4} x2={bx} y2={by + 4} stroke="#6b7280" strokeWidth={1.5} />
        <line x1={bx + barPx} y1={by - 4} x2={bx + barPx} y2={by + 4} stroke="#6b7280" strokeWidth={1.5} />
        <text x={bx + barPx / 2} y={by - 8} fontSize={10} fill="#6b7280" textAnchor="middle">{barLen}</text>
      </g>
    )
  }

  // Tooltip
  const tooltip = hovered && (() => {
    const pos = getXY(hovered)
    const isLeaf = hovered.children.length === 0
    return (
      <div className="absolute pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl z-50"
        style={{ left: pos.x * zoom + pan.x + 20, top: pos.y * zoom + pan.y - 10 }}>
        <div className="font-semibold">{hovered.name || '(internal node)'}</div>
        <div className="text-gray-300 mt-0.5">Branch length: {hovered.length.toFixed(6)}</div>
        {!isLeaf && <div className="text-gray-300">Descendants: {countDescendants(hovered)}</div>}
        <div className="text-gray-400 text-[10px] mt-1">{isLeaf ? 'Leaf' : 'Click to highlight clade'}</div>
      </div>
    )
  })()

  const modes = [
    { key: 'rectangular', label: 'Rectangular' },
    { key: 'radial', label: 'Radial' },
    { key: 'unrooted', label: 'Unrooted' },
  ]

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {modes.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
              mode === m.key ? 'bg-sky-100 text-sky-700 shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {m.label}
          </button>
        ))}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={() => setShowLengths(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          title="Toggle branch lengths">
          {showLengths ? <EyeOff size={14}/> : <Eye size={14}/>}
          <span className="hidden sm:inline">Lengths</span>
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={() => setZoom(z => Math.min(10, z * 1.3))}
          className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors" title="Zoom in">
          <ZoomIn size={16}/>
        </button>
        <button onClick={() => setZoom(z => Math.max(0.2, z * 0.77))}
          className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors" title="Zoom out">
          <ZoomOut size={16}/>
        </button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setHighlightClade(null) }}
          className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors" title="Reset view">
          <RotateCcw size={16}/>
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={() => svgRef.current && exportSVG(svgRef.current, 'phylo-tree.svg')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          <Download size={14}/> SVG
        </button>
        <button onClick={() => svgRef.current && exportPNG(svgRef.current, 'phylo-tree.png')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          <Download size={14}/> PNG
        </button>
      </div>

      {/* SVG viewport */}
      <div ref={wrapRef} className="relative overflow-hidden border rounded-xl bg-white select-none"
        style={{ height: Math.min(height * zoom + 40, 800), cursor: dragging.current ? 'grabbing' : 'grab' }}
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onClick={() => setHighlightClade(null)}>
        <svg ref={svgRef} width={width} height={height}
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: '0 0', transition: dragging.current ? 'none' : 'transform 0.15s ease-out' }}>
          <rect width={width} height={height} fill="white" />
          {lines}
          {lengthLabels}
          {nodes}
          {labels}
          {scaleBar}
        </svg>
        {tooltip}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-400">
        <span>Scroll to zoom</span>
        <span>Drag to pan</span>
        <span>Click internal node to highlight clade</span>
        <span>{leafCount} leaves</span>
        {highlightClade && (
          <button onClick={() => setHighlightClade(null)}
            className="text-sky-600 hover:underline">Clear highlight</button>
        )}
      </div>
    </div>
  )
}
