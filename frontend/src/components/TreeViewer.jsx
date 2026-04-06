import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import {
  Download, ZoomIn, ZoomOut, RotateCcw, Maximize, Search, X,
  GitBranch, Type, Ruler, Grid3X3, Moon, Sun
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════
   PALETTE & CONSTANTS
   ═══════════════════════════════════════════════════════════════ */
const PALETTE = [
  '#2563eb','#9333ea','#d97706','#059669','#dc2626',
  '#db2777','#0891b2','#ea580c','#4f46e5','#0d9488',
  '#be123c','#65a30d','#7c3aed','#e11d48','#06b6d4',
]
const LIGHT_BG = '#ffffff'
const DARK_BG  = '#1e1e2e'

/* ═══════════════════════════════════════════════════════════════
   NEWICK PARSER
   ═══════════════════════════════════════════════════════════════ */
let _nid = 0
function parseNewick(str) {
  _nid = 0
  const s = str.trim().replace(/;$/, '')
  let i = 0
  function read() {
    const n = { id: _nid++, ch: [], name: '', len: 0 }
    if (s[i] === '(') {
      i++
      n.ch.push(read())
      while (s[i] === ',') { i++; n.ch.push(read()) }
      i++ // ')'
    }
    let nm = ''
    while (i < s.length && ![':',',',')','(',';'].includes(s[i])) nm += s[i++]
    n.name = nm.trim()
    if (s[i] === ':') {
      i++
      let l = ''
      while (i < s.length && ![',',')',';','('].includes(s[i])) l += s[i++]
      n.len = parseFloat(l) || 0
    }
    return n
  }
  return read()
}

/* ═══════════════════════════════════════════════════════════════
   TREE METRICS
   ═══════════════════════════════════════════════════════════════ */
function leafCount(n) { return n.ch.length === 0 ? 1 : n.ch.reduce((s,c) => s + leafCount(c), 0) }
function descCount(n) { return n.ch.length === 0 ? 0 : n.ch.reduce((s,c) => s + 1 + descCount(c), 0) }
function treeDepth(n, d=0) {
  return n.ch.length === 0 ? d + n.len : Math.max(...n.ch.map(c => treeDepth(c, d + n.len)))
}
function flatten(n, p=null, l=[]) { l.push({n, p}); n.ch.forEach(c => flatten(c, n, l)); return l }
function cladeIds(n) { const r=[n.id]; n.ch.forEach(c => cladeIds(c).forEach(x => r.push(x))); return r }

/* ═══════════════════════════════════════════════════════════════
   LAYOUTS
   ═══════════════════════════════════════════════════════════════ */
function layoutRect(root) {
  const md = treeDepth(root); let li = 0
  ;(function w(n, d) {
    n._d = d
    if (n.ch.length === 0) { n._y = li++; n._x = d }
    else {
      n.ch.forEach(c => w(c, d + n.len))
      const ys = n.ch.map(c => c._y)
      n._y = (Math.min(...ys) + Math.max(...ys)) / 2
      n._x = d
    }
  })(root, 0)
  return { lc: li, md }
}

function layoutRadial(root) {
  const lc = leafCount(root), md = treeDepth(root); let li = 0
  ;(function w(n, d) {
    n._d = d; n._r = d
    if (n.ch.length === 0) { n._a = (li / lc) * 2 * Math.PI; li++ }
    else {
      n.ch.forEach(c => w(c, d + n.len))
      const aa = n.ch.map(c => c._a)
      n._a = (Math.min(...aa) + Math.max(...aa)) / 2
    }
  })(root, 0)
  return { lc, md }
}

function layoutUnrooted(root) {
  const lc = leafCount(root), md = treeDepth(root)
  ;(function w(n, x, y, a0, a1, d) {
    n._ux = x; n._uy = y; n._d = d
    if (n.ch.length === 0) return
    let cum = 0; const tot = leafCount(n)
    n.ch.forEach(c => {
      const cl = leafCount(c)
      const s = a0 + (cum/tot)*(a1-a0), e = a0 + ((cum+cl)/tot)*(a1-a0), m = (s+e)/2
      const l = Math.max(c.len, 0.001)
      w(c, x+Math.cos(m)*l*300, y+Math.sin(m)*l*300, s, e, d+c.len)
      cum += cl
    })
  })(root, 0, 0, 0, 2*Math.PI, 0)
  return { lc, md }
}

/* ═══════════════════════════════════════════════════════════════
   CLADE COLORS
   ═══════════════════════════════════════════════════════════════ */
function assignColors(root) {
  const m = {}
  if (root.ch.length === 0) { m[root.id] = PALETTE[0]; return m }
  function paint(n, c) { m[n.id] = c; n.ch.forEach(x => paint(x, c)) }
  root.ch.forEach((c, i) => paint(c, PALETTE[i % PALETTE.length]))
  m[root.id] = '#94a3b8'
  return m
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT HELPERS
   ═══════════════════════════════════════════════════════════════ */
function doExportSVG(el, fn) {
  const d = new XMLSerializer().serializeToString(el)
  const b = new Blob([d], { type: 'image/svg+xml' })
  const u = URL.createObjectURL(b)
  Object.assign(document.createElement('a'), { href: u, download: fn }).click()
  URL.revokeObjectURL(u)
}
function doExportPNG(el, fn, sc=3) {
  const d = new XMLSerializer().serializeToString(el)
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = el.clientWidth*sc; c.height = el.clientHeight*sc
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height)
    ctx.drawImage(img,0,0,c.width,c.height)
    c.toBlob(b => {
      const u = URL.createObjectURL(b)
      Object.assign(document.createElement('a'), { href: u, download: fn }).click()
      URL.revokeObjectURL(u)
    })
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(d)))
}

/* ═══════════════════════════════════════════════════════════════
   TOOLBAR BUTTON
   ═══════════════════════════════════════════════════════════════ */
function Btn({ children, active, onClick, title, className = '' }) {
  return (
    <button onClick={onClick} title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg
        transition-all duration-150 select-none border
        ${active
          ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-sm'
          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
        } ${className}`}>
      {children}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function TreeViewer({ newick }) {
  const svgRef   = useRef(null)
  const wrapRef  = useRef(null)
  const innerRef = useRef(null)

  // State
  const [mode, setMode]             = useState('rectangular')
  const [showLengths, setShowLen]   = useState(false)
  const [showNodes, setShowNodes]   = useState(true)
  const [showGrid, setShowGrid]     = useState(false)
  const [dark, setDark]             = useState(false)
  const [searchTerm, setSearch]     = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [wrapW, setWrapW]          = useState(900)
  const [hovered, setHovered]       = useState(null)
  const [hlClade, setHlClade]       = useState(null)

  // SVG viewBox pan/zoom (proper approach — no CSS transform bugs)
  const [vb, setVb] = useState({ x: 0, y: 0, w: 900, h: 600 })
  const drag = useRef({ active: false, start: {x:0,y:0}, vbStart: {x:0,y:0} })

  // Responsive container width
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(([e]) => setWrapW(e.contentRect.width))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // Parse & layout
  const tree = useMemo(() => {
    if (!newick) return null
    const root = parseNewick(newick)
    const layout = mode === 'radial' ? layoutRadial(root)
                 : mode === 'unrooted' ? layoutUnrooted(root)
                 : layoutRect(root)
    return { root, ...layout, colors: assignColors(root), flat: flatten(root) }
  }, [newick, mode])

  // Compute SVG dimensions from tree
  const dims = useMemo(() => {
    if (!tree) return { svgW: 900, svgH: 600, PAD: {t:0,b:0,l:0,r:0}, scX:1, scY:1 }
    const PAD = { t: 50, b: 60, l: 40, r: 200 }
    const svgW = Math.max(wrapW, 700)
    const svgH = mode === 'rectangular'
      ? Math.max(500, tree.lc * 34) + PAD.t + PAD.b
      : Math.max(600, svgW * 0.8)
    const dW = svgW - PAD.l - PAD.r
    const dH = svgH - PAD.t - PAD.b
    const scX = tree.md > 0 ? dW / tree.md : 1
    const scY = tree.lc > 1 ? dH / (tree.lc - 1) : dH / 2
    return { svgW, svgH, PAD, scX, scY, dW, dH }
  }, [tree, wrapW, mode])

  // Reset viewBox when mode/data changes
  useEffect(() => {
    setVb({ x: 0, y: 0, w: dims.svgW, h: dims.svgH })
    setHlClade(null)
  }, [dims.svgW, dims.svgH, mode])

  // Highlighted clade IDs
  const hlIds = useMemo(() => {
    if (!hlClade || !tree) return new Set()
    const t = tree.flat.find(f => f.n.id === hlClade)
    return t ? new Set(cladeIds(t.n)) : new Set()
  }, [hlClade, tree])

  // Search matches
  const searchMatches = useMemo(() => {
    if (!searchTerm || !tree) return new Set()
    const q = searchTerm.toLowerCase()
    return new Set(tree.flat.filter(f => f.n.name.toLowerCase().includes(q)).map(f => f.n.id))
  }, [searchTerm, tree])

  /* ── Pan/Zoom via viewBox (proper SVG approach) ── */
  const handleWheel = useCallback(e => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 0.85 : 1.18
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    // Mouse position in viewBox coords
    setVb(prev => {
      const mx = prev.x + (e.clientX - rect.left) / rect.width * prev.w
      const my = prev.y + (e.clientY - rect.top) / rect.height * prev.h
      const nw = Math.max(50, Math.min(prev.w * 20, prev.w * factor))
      const nh = Math.max(50, Math.min(prev.h * 20, prev.h * factor))
      return {
        x: mx - (mx - prev.x) * (nw / prev.w),
        y: my - (my - prev.y) * (nh / prev.h),
        w: nw, h: nh,
      }
    })
  }, [])

  const handleMouseDown = useCallback(e => {
    if (e.button !== 0) return
    drag.current = { active: true, start: {x: e.clientX, y: e.clientY}, vbStart: {...vb} }
  }, [vb])

  const handleMouseMove = useCallback(e => {
    if (!drag.current.active) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const dx = (e.clientX - drag.current.start.x) / rect.width * drag.current.vbStart.w
    const dy = (e.clientY - drag.current.start.y) / rect.height * drag.current.vbStart.h
    setVb({
      x: drag.current.vbStart.x - dx,
      y: drag.current.vbStart.y - dy,
      w: drag.current.vbStart.w,
      h: drag.current.vbStart.h,
    })
  }, [])

  const handleMouseUp = useCallback(() => { drag.current.active = false }, [])

  // Fit to view
  const fitView = useCallback(() => {
    setVb({ x: 0, y: 0, w: dims.svgW, h: dims.svgH })
  }, [dims.svgW, dims.svgH])

  // Zoom buttons
  const zoomIn  = useCallback(() => setVb(v => {
    const cx = v.x + v.w/2, cy = v.y + v.h/2, nw = v.w*0.7, nh = v.h*0.7
    return { x: cx-nw/2, y: cy-nh/2, w: nw, h: nh }
  }), [])
  const zoomOut = useCallback(() => setVb(v => {
    const cx = v.x + v.w/2, cy = v.y + v.h/2, nw = v.w*1.4, nh = v.h*1.4
    return { x: cx-nw/2, y: cy-nh/2, w: nw, h: nh }
  }), [])

  /* ── Early returns ── */
  if (!newick) {
    return <div className="bg-white rounded-xl border p-8 text-center text-gray-400">No tree data available</div>
  }
  if (!tree) return null

  const { root, flat, colors } = tree
  const { svgW, svgH, PAD, scX, scY, dW, dH } = dims
  const bg = dark ? DARK_BG : LIGHT_BG
  const fg = dark ? '#e2e8f0' : '#1e293b'
  const fgSub = dark ? '#94a3b8' : '#6b7280'
  const fgDim = dark ? '#475569' : '#cbd5e1'

  /* ── Coordinate converters ── */
  function rXY(n) { return { x: PAD.l + n._x * scX, y: PAD.t + n._y * scY } }
  function radXY(n) {
    const r = tree.md > 0 ? (n._r / tree.md) * Math.min(dW, dH) * 0.42 : 0
    return { x: svgW/2 + Math.cos(n._a)*r, y: svgH/2 + Math.sin(n._a)*r, a: n._a }
  }
  function uXY(n) { return { x: svgW/2 + (n._ux||0), y: svgH/2 + (n._uy||0) } }
  function xy(n) { return mode==='radial' ? radXY(n) : mode==='unrooted' ? uXY(n) : rXY(n) }

  /* ── Build SVG elements ── */
  const elLines = [], elNodes = [], elLabels = [], elLenLabels = [], elGrid = []

  // Grid lines (rectangular mode)
  if (showGrid && mode === 'rectangular' && tree.md > 0) {
    const steps = 5
    for (let i = 0; i <= steps; i++) {
      const xp = PAD.l + (i / steps) * dW
      elGrid.push(
        <line key={`grid-${i}`} x1={xp} y1={PAD.t - 10} x2={xp} y2={svgH - PAD.b + 10}
          stroke={dark ? '#334155' : '#f1f5f9'} strokeWidth={1} />
      )
      elGrid.push(
        <text key={`gridl-${i}`} x={xp} y={PAD.t - 16} fontSize={9} fill={fgSub} textAnchor="middle">
          {((i / steps) * tree.md).toFixed(3)}
        </text>
      )
    }
  }

  flat.forEach(({ n, p }) => {
    const pos = xy(n)
    const isLeaf = n.ch.length === 0
    const color = colors[n.id] || '#94a3b8'
    const dimHL = hlIds.size > 0 && !hlIds.has(n.id)
    const isSearchHit = searchMatches.has(n.id)
    const opacity = dimHL ? 0.08 : 1

    /* ── Branches (MEGA-style proper elbow connectors) ── */
    if (p) {
      const pp = xy(p)
      if (mode === 'rectangular') {
        // Parent end-x = where parent's horizontal branch ends = parent._x + parent.len
        const jx = PAD.l + (p._x + p.len) * scX
        // Vertical connector from parent-y to child-y at junction-x
        elLines.push(
          <line key={`v-${n.id}`} x1={jx} y1={pp.y} x2={jx} y2={pos.y}
            stroke={color} strokeWidth={1.8} opacity={opacity}
            strokeLinecap="round" />
        )
        // Horizontal connector from junction-x to child-x
        elLines.push(
          <line key={`h-${n.id}`} x1={jx} y1={pos.y} x2={pos.x} y2={pos.y}
            stroke={color} strokeWidth={1.8} opacity={opacity}
            strokeLinecap="round" />
        )
        // Branch length label
        if (showLengths && n.len > 0) {
          elLenLabels.push(
            <text key={`bl-${n.id}`} x={(jx + pos.x) / 2} y={pos.y - 7}
              fontSize={9} fill={fgSub} textAnchor="middle" opacity={opacity}
              fontFamily="monospace">
              {n.len.toFixed(n.len < 0.01 ? 4 : 2)}
            </text>
          )
        }
      } else {
        // Radial / Unrooted: straight line
        elLines.push(
          <line key={`br-${n.id}`} x1={pp.x} y1={pp.y} x2={pos.x} y2={pos.y}
            stroke={color} strokeWidth={1.8} opacity={opacity} strokeLinecap="round" />
        )
        if (showLengths && n.len > 0) {
          const mx = (pp.x + pos.x) / 2, my = (pp.y + pos.y) / 2
          elLenLabels.push(
            <text key={`bl-${n.id}`} x={mx} y={my - 6}
              fontSize={9} fill={fgSub} textAnchor="middle" opacity={opacity}
              fontFamily="monospace">
              {n.len.toFixed(n.len < 0.01 ? 4 : 2)}
            </text>
          )
        }
      }
    }

    // Root leading line (rectangular)
    if (!p && mode === 'rectangular' && n.ch.length > 0) {
      const endX = PAD.l + n.len * scX
      elLines.push(
        <line key="root-line" x1={PAD.l} y1={pos.y} x2={endX} y2={pos.y}
          stroke="#94a3b8" strokeWidth={1.8} strokeLinecap="round" />
      )
    }

    /* ── Node dot ── */
    if (showNodes || isLeaf) {
      const r = isLeaf ? 4.5 : (hlClade === n.id ? 6 : 3.5)
      const fill = isLeaf
        ? (isSearchHit ? '#facc15' : color)
        : (hlClade === n.id ? '#1e293b' : (dark ? '#334155' : '#fff'))
      elNodes.push(
        <circle key={`nd-${n.id}`} cx={pos.x} cy={pos.y} r={r}
          fill={fill} stroke={isLeaf ? 'none' : color}
          strokeWidth={isLeaf ? 0 : 2} opacity={opacity}
          style={{ cursor: isLeaf ? 'default' : 'pointer', transition: 'all 0.2s' }}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          onClick={e => { e.stopPropagation(); if (!isLeaf) setHlClade(prev => prev === n.id ? null : n.id) }}
        />
      )
    }

    /* ── Leaf labels ── */
    if (isLeaf && n.name) {
      const highlight = isSearchHit
      if (mode === 'radial') {
        const a = n._a, flip = a > Math.PI/2 && a < 3*Math.PI/2
        elLabels.push(
          <text key={`lb-${n.id}`} x={pos.x} y={pos.y}
            transform={`rotate(${(a*180/Math.PI)+(flip?180:0)}, ${pos.x}, ${pos.y})`}
            dx={flip ? -10 : 10} dy={4}
            fontSize={12} fill={highlight ? '#facc15' : fg}
            fontWeight={highlight ? 700 : 400}
            fontFamily="'Inter', system-ui, sans-serif"
            textAnchor={flip ? 'end' : 'start'} opacity={opacity}>
            {n.name}
          </text>
        )
      } else {
        elLabels.push(
          <text key={`lb-${n.id}`} x={pos.x + 10} y={pos.y + 4}
            fontSize={12} fill={highlight ? '#facc15' : fg}
            fontWeight={highlight ? 700 : 400}
            fontFamily="'Inter', system-ui, sans-serif"
            opacity={opacity}>
            {n.name}
          </text>
        )
      }
    }

    /* ── Internal node bootstrap label (if name is numeric) ── */
    if (!isLeaf && n.name && showNodes) {
      elLabels.push(
        <text key={`int-${n.id}`} x={pos.x} y={pos.y - 8}
          fontSize={9} fill={fgSub} textAnchor="middle" opacity={opacity}
          fontFamily="monospace">
          {n.name}
        </text>
      )
    }
  })

  /* ── Scale bar (rectangular) ── */
  let scaleBar = null
  if (mode === 'rectangular' && tree.md > 0) {
    const mag = Math.pow(10, Math.floor(Math.log10(tree.md)))
    const bl = tree.md / mag >= 5 ? mag : mag / 2
    const bpx = bl * scX
    const bx = PAD.l, by = svgH - 25
    scaleBar = (
      <g>
        <line x1={bx} y1={by} x2={bx+bpx} y2={by} stroke={fgSub} strokeWidth={1.5} />
        <line x1={bx} y1={by-4} x2={bx} y2={by+4} stroke={fgSub} strokeWidth={1.5} />
        <line x1={bx+bpx} y1={by-4} x2={bx+bpx} y2={by+4} stroke={fgSub} strokeWidth={1.5} />
        <text x={bx+bpx/2} y={by-9} fontSize={10} fill={fgSub} textAnchor="middle" fontFamily="monospace">{bl}</text>
      </g>
    )
  }

  /* ── Tooltip ── */
  const tooltip = hovered ? (() => {
    const isLeaf = hovered.ch.length === 0
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const pos = xy(hovered)
    // Convert SVG coords to screen coords considering viewBox
    const sx = rect.left + ((pos.x - vb.x) / vb.w) * rect.width
    const sy = rect.top + ((pos.y - vb.y) / vb.h) * rect.height
    return (
      <div className="fixed pointer-events-none z-[100]"
        style={{ left: sx + 16, top: sy - 8 }}>
        <div className={`rounded-xl px-3.5 py-2.5 shadow-2xl border text-xs
          ${dark ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-200 text-gray-800'}`}>
          <div className="font-bold text-sm">{hovered.name || '(internal)'}</div>
          <div className="mt-1 space-y-0.5">
            <div><span className="text-gray-400">Branch length:</span> {hovered.len.toFixed(6)}</div>
            {!isLeaf && <div><span className="text-gray-400">Descendants:</span> {descCount(hovered)}</div>}
            <div><span className="text-gray-400">Type:</span> {isLeaf ? 'Leaf (taxon)' : 'Internal node'}</div>
          </div>
          {!isLeaf && <div className="mt-1.5 text-[10px] text-gray-400">Click to highlight clade</div>}
        </div>
      </div>
    )
  })() : null

  /* ── Title info ── */
  const treeTitle = `Evolutionary relationships of ${tree.lc} taxa`

  const modes = [
    { key: 'rectangular', label: 'Rectangular', icon: '┤' },
    { key: 'radial',      label: 'Radial',      icon: '◎' },
    { key: 'unrooted',    label: 'Unrooted',    icon: '✱' },
  ]

  const viewportH = Math.min(
    mode === 'rectangular' ? Math.max(520, tree.lc * 26 + 60) : 600,
    720
  )

  return (
    <div className={`rounded-2xl border overflow-hidden ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
      {/* ── Header ── */}
      <div className={`px-4 py-3 border-b flex items-center justify-between
        ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
        <div className="flex items-center gap-2">
          <GitBranch size={16} className={dark ? 'text-sky-400' : 'text-sky-600'} />
          <span className={`text-sm font-semibold ${dark ? 'text-gray-200' : 'text-gray-700'}`}>
            {treeTitle}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {searchOpen ? (
            <div className="flex items-center gap-1">
              <input type="text" value={searchTerm}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search taxon..."
                autoFocus
                className={`w-40 px-2.5 py-1 text-xs rounded-lg border outline-none
                  ${dark ? 'bg-gray-800 border-gray-600 text-gray-200 placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-700'}`}
              />
              <button onClick={() => { setSearchOpen(false); setSearch('') }}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                <X size={14} className={dark ? 'text-gray-400' : 'text-gray-500'} />
              </button>
            </div>
          ) : (
            <Btn onClick={() => setSearchOpen(true)} title="Search taxon"><Search size={13}/></Btn>
          )}
          <Btn onClick={() => setDark(v => !v)} title="Toggle theme">
            {dark ? <Sun size={13}/> : <Moon size={13}/>}
          </Btn>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className={`px-4 py-2 flex flex-wrap items-center gap-1.5 border-b
        ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gray-50/50'}`}>
        {/* Mode selector */}
        {modes.map(m => (
          <Btn key={m.key} active={mode === m.key} onClick={() => setMode(m.key)} title={m.label}>
            <span className="text-[11px]">{m.icon}</span> {m.label}
          </Btn>
        ))}
        <div className={`w-px h-5 mx-1 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`} />

        {/* Toggle controls */}
        <Btn active={showLengths} onClick={() => setShowLen(v => !v)} title="Branch lengths">
          <Ruler size={13}/> Lengths
        </Btn>
        <Btn active={showNodes} onClick={() => setShowNodes(v => !v)} title="Toggle node dots">
          <Type size={13}/> Nodes
        </Btn>
        {mode === 'rectangular' && (
          <Btn active={showGrid} onClick={() => setShowGrid(v => !v)} title="Distance grid">
            <Grid3X3 size={13}/> Grid
          </Btn>
        )}
        <div className={`w-px h-5 mx-1 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`} />

        {/* Zoom controls */}
        <Btn onClick={zoomIn} title="Zoom in"><ZoomIn size={14}/></Btn>
        <Btn onClick={zoomOut} title="Zoom out"><ZoomOut size={14}/></Btn>
        <Btn onClick={fitView} title="Fit to view"><Maximize size={13}/></Btn>
        <Btn onClick={() => { fitView(); setHlClade(null); setSearch('') }} title="Reset all">
          <RotateCcw size={13}/>
        </Btn>
        <div className={`w-px h-5 mx-1 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`} />

        {/* Export */}
        <Btn onClick={() => svgRef.current && doExportSVG(svgRef.current, 'phylo-tree.svg')}>
          <Download size={13}/> SVG
        </Btn>
        <Btn onClick={() => svgRef.current && doExportPNG(svgRef.current, 'phylo-tree.png')}>
          <Download size={13}/> PNG
        </Btn>
      </div>

      {/* ── SVG Viewport ── */}
      <div ref={wrapRef}
        className="relative select-none"
        style={{ height: viewportH, cursor: drag.current.active ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => setHlClade(null)}>
        <svg ref={svgRef}
          width="100%" height="100%"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}>
          <rect x={vb.x - 1000} y={vb.y - 1000} width={vb.w + 2000} height={vb.h + 2000} fill={bg} />
          {elGrid}
          {elLines}
          {elLenLabels}
          {elNodes}
          {elLabels}
          {scaleBar}
        </svg>
        {tooltip}

        {/* ── Minimap ── */}
        <svg className="absolute bottom-3 right-3 rounded-lg border shadow-lg overflow-hidden"
          width={140} height={90}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ opacity: 0.85, background: dark ? '#1e293b' : '#f8fafc',
                   borderColor: dark ? '#475569' : '#e2e8f0' }}
          onClick={e => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            const fx = (e.clientX - r.left) / r.width
            const fy = (e.clientY - r.top) / r.height
            setVb(prev => ({
              ...prev,
              x: fx * svgW - prev.w / 2,
              y: fy * svgH - prev.h / 2,
            }))
          }}>
          {/* Simplified tree lines */}
          {flat.filter(f => f.p).map(({ n, p }) => {
            const a = xy(n), b = xy(p)
            return <line key={`mm-${n.id}`} x1={b.x} y1={b.y} x2={a.x} y2={a.y}
              stroke={dark ? '#475569' : '#cbd5e1'} strokeWidth={Math.max(svgW/200, 2)} />
          })}
          {/* Viewport indicator */}
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h}
            fill="none" stroke="#3b82f6" strokeWidth={Math.max(svgW/120, 3)}
            rx={4} opacity={0.7} />
        </svg>
      </div>

      {/* ── Footer ── */}
      <div className={`px-4 py-2 border-t flex flex-wrap items-center justify-between gap-2 text-[11px]
        ${dark ? 'border-gray-700 text-gray-500' : 'border-gray-100 text-gray-400'}`}>
        <div className="flex items-center gap-3">
          <span>🖱 Scroll = zoom</span>
          <span>✊ Drag = pan</span>
          <span>⬤ Click node = highlight clade</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{tree.lc} taxa</span>
          <span>Max depth: {tree.md.toFixed(4)}</span>
          {searchMatches.size > 0 && <span className="text-yellow-500">{searchMatches.size} matches</span>}
          {hlClade != null && (
            <button onClick={e => { e.stopPropagation(); setHlClade(null) }}
              className="text-sky-500 hover:underline">Clear clade</button>
          )}
        </div>
      </div>
    </div>
  )
}
