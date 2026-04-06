import { useRef, useEffect, useState, useCallback } from 'react'

// ── Newick parser ────────────────────────────────────────────
function parseNewick(str) {
  const s = str.trim().replace(/;$/, '')
  let i = 0

  function readNode() {
    const node = { children: [], name: '', length: 0 }
    if (s[i] === '(') {
      i++ // skip '('
      node.children.push(readNode())
      while (s[i] === ',') {
        i++ // skip ','
        node.children.push(readNode())
      }
      i++ // skip ')'
    }
    // read name
    let name = ''
    while (i < s.length && s[i] !== ':' && s[i] !== ',' && s[i] !== ')' && s[i] !== ';') {
      name += s[i++]
    }
    node.name = name.trim()
    // read length
    if (s[i] === ':') {
      i++
      let len = ''
      while (i < s.length && s[i] !== ',' && s[i] !== ')' && s[i] !== ';') {
        len += s[i++]
      }
      node.length = parseFloat(len) || 0
    }
    return node
  }

  return readNode()
}

// ── Layout computation ───────────────────────────────────────
function layoutTree(root) {
  const leaves = []
  function collectLeaves(n) {
    if (n.children.length === 0) leaves.push(n)
    else n.children.forEach(collectLeaves)
  }
  collectLeaves(root)

  function getMaxDepth(n, depth) {
    if (n.children.length === 0) return depth + n.length
    return Math.max(...n.children.map(c => getMaxDepth(c, depth + n.length)))
  }
  const maxDepth = getMaxDepth(root, 0)

  let leafIndex = 0
  function assignCoords(node, depth) {
    node._depth = depth
    if (node.children.length === 0) {
      node._leafIdx = leafIndex++
      node._y = node._leafIdx
    } else {
      node.children.forEach(c => assignCoords(c, depth + node.length))
      const ys = node.children.map(c => c._y)
      node._y = (Math.min(...ys) + Math.max(...ys)) / 2
    }
    node._x = depth
  }

  assignCoords(root, 0)
  return { leafCount: leaves.length, maxDepth, leaves }
}

// ── Canvas rendering ─────────────────────────────────────────
const COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#06b6d4', '#f97316']

function renderTree(ctx, root, width, height, leafCount, maxDepth, mode) {
  const pad = { top: 30, bottom: 30, left: 20, right: 160 }
  const drawW = width - pad.left - pad.right
  const drawH = height - pad.top - pad.bottom

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const scaleX = maxDepth > 0 ? drawW / maxDepth : 1
  const scaleY = leafCount > 1 ? drawH / (leafCount - 1) : drawH / 2

  function toCanvas(node) {
    if (mode === 'circular') {
      const angle = (node._y / (leafCount || 1)) * Math.PI * 1.8 - Math.PI * 0.9
      const radius = (node._x / (maxDepth || 1)) * Math.min(drawW, drawH) * 0.4
      const cx = width / 2
      const cy = height / 2
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle }
    }
    return {
      x: pad.left + node._x * scaleX,
      y: pad.top + node._y * scaleY,
    }
  }

  let colorIdx = 0
  function drawBranches(node, depth) {
    const p = toCanvas(node)
    const color = COLORS[depth % COLORS.length]

    node.children.forEach(child => {
      const c = toCanvas(child)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5

      if (mode === 'circular') {
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(c.x, c.y)
      } else {
        // Rectangular cladogram style
        const childStartX = pad.left + (node._x + node.length) * scaleX
        ctx.moveTo(childStartX, p.y)
        ctx.lineTo(childStartX, c.y)
        ctx.moveTo(childStartX, c.y)
        ctx.lineTo(c.x, c.y)
      }
      ctx.stroke()
      drawBranches(child, depth + 1)
    })

    // Draw horizontal line from parent connection to this node
    if (node !== root) {
      // Already handled in parent's child loop
    }

    // Draw leaf label + dot
    if (node.children.length === 0 && node.name) {
      const pos = toCanvas(node)
      ctx.fillStyle = '#1f2937'
      ctx.font = '12px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      if (mode === 'circular') {
        ctx.save()
        ctx.translate(pos.x, pos.y)
        const angle = pos.angle || 0
        ctx.rotate(angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle)
        ctx.textAlign = angle > Math.PI / 2 || angle < -Math.PI / 2 ? 'right' : 'left'
        ctx.fillText(` ${node.name}`, 0, 0)
        ctx.restore()
      } else {
        ctx.textAlign = 'left'
        ctx.fillText(` ${node.name}`, pos.x + 6, pos.y)
      }

      ctx.beginPath()
      ctx.fillStyle = COLORS[colorIdx++ % COLORS.length]
      ctx.arc(pos.x, pos.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Draw root horizontal line
  const rootPos = toCanvas(root)
  if (mode !== 'circular' && root.children.length > 0) {
    const endX = pad.left + root.length * scaleX
    ctx.beginPath()
    ctx.strokeStyle = COLORS[0]
    ctx.lineWidth = 1.5
    ctx.moveTo(rootPos.x, rootPos.y)
    ctx.lineTo(endX, rootPos.y)
    ctx.stroke()
  }

  drawBranches(root, 0)

  // Scale bar
  if (mode !== 'circular' && maxDepth > 0) {
    const mag = Math.pow(10, Math.floor(Math.log10(maxDepth)))
    const barLen = mag <= 0 ? 0.01 : (maxDepth / mag >= 5 ? mag : mag / 2)
    const barPx = barLen * scaleX
    const bx = pad.left
    const by = height - 14
    ctx.beginPath()
    ctx.strokeStyle = '#6b7280'
    ctx.lineWidth = 1.5
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + barPx, by)
    ctx.stroke()
    // Ticks
    ctx.moveTo(bx, by - 3)
    ctx.lineTo(bx, by + 3)
    ctx.moveTo(bx + barPx, by - 3)
    ctx.lineTo(bx + barPx, by + 3)
    ctx.stroke()
    ctx.fillStyle = '#6b7280'
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(barLen.toString(), bx + barPx / 2, by - 8)
  }
}

// ── React component ──────────────────────────────────────────
export default function TreeViewer({ newick }) {
  const canvasRef = useRef(null)
  const [mode, setMode] = useState('rectangular')

  const draw = useCallback(() => {
    if (!newick || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    const displayW = canvas.parentElement.clientWidth
    const root = parseNewick(newick)
    const { leafCount, maxDepth } = layoutTree(root)
    const displayH = Math.max(400, leafCount * 36)

    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = displayW + 'px'
    canvas.style.height = displayH + 'px'
    ctx.scale(dpr, dpr)

    renderTree(ctx, root, displayW, displayH, leafCount, maxDepth, mode)
  }, [newick, mode])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    const handler = () => draw()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [draw])

  if (!newick) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
        No tree data available
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {['rectangular', 'circular'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              mode === m
                ? 'bg-sky-100 text-sky-700 font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      <div className="overflow-auto border rounded-lg bg-white">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
