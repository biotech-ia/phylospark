import { useState, useContext, useRef, useEffect } from 'react'
import { Cpu, X, Check, AlertCircle } from 'lucide-react'
import { ModelContext } from '../contexts/ModelContext'
import { ai } from '../api'

export default function FloatingModelSelector() {
  const { chatModel, reasoningModel, setChatModel, setReasoningModel, availableModels, modelsLoading } = useContext(ModelContext)
  const [open, setOpen] = useState(false)
  const [health, setHealth] = useState({})
  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('phylo_selector_pos')
    return saved ? JSON.parse(saved) : { x: 20, y: window.innerHeight - 80 }
  })
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const ref = useRef(null)

  const chatModels = availableModels.filter(m => m.type === 'chat')
  const reasoningModels = availableModels.filter(m => m.type === 'reasoning')

  const currentLabel = chatModel?.replace('deepseek-', 'DS-').replace('gpt-4o-mini', 'GPT-4m') || 'AI'

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging) return
      const nx = e.clientX - dragOffset.current.x
      const ny = e.clientY - dragOffset.current.y
      const bounded = {
        x: Math.max(0, Math.min(nx, window.innerWidth - 50)),
        y: Math.max(0, Math.min(ny, window.innerHeight - 50)),
      }
      setPosition(bounded)
    }
    const onUp = () => {
      if (dragging) {
        setDragging(false)
        localStorage.setItem('phylo_selector_pos', JSON.stringify(position))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, position])

  const checkHealth = async (modelId) => {
    setHealth(h => ({ ...h, [modelId]: 'checking' }))
    try {
      const res = await ai.modelHealth(modelId)
      setHealth(h => ({ ...h, [modelId]: res.data.status }))
    } catch {
      setHealth(h => ({ ...h, [modelId]: 'unhealthy' }))
    }
  }

  const onMouseDown = (e) => {
    if (e.target.closest('button, select')) return
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    setDragging(true)
  }

  if (modelsLoading || availableModels.length === 0) return null

  return (
    <div
      ref={ref}
      className="fixed z-50 select-none"
      style={{ left: position.x, top: position.y }}
      onMouseDown={onMouseDown}
    >
      {/* Collapsed bubble */}
      {!open && (
        <div
          onClick={() => setOpen(true)}
          className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600
                     flex items-center justify-center cursor-pointer shadow-lg
                     hover:scale-110 transition-transform group"
          title={`Chat: ${chatModel} | Reasoning: ${reasoningModel}`}
        >
          <Cpu size={18} className="text-white" />
          <div className="absolute left-12 bg-gray-900 text-white text-xs px-2 py-1 rounded
                          opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none">
            {currentLabel}
          </div>
        </div>
      )}

      {/* Expanded panel */}
      {open && (
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-72 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2.5 flex items-center justify-between">
            <span className="text-white text-sm font-semibold flex items-center gap-2">
              <Cpu size={16} /> AI Models
            </span>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <div className="p-3 space-y-3">
            {/* Chat model */}
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Chat Model</label>
              <div className="flex items-center gap-2">
                <select
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  className="flex-1 text-sm border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-300 outline-none"
                >
                  {chatModels.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <HealthDot status={health[chatModel]} onClick={() => checkHealth(chatModel)} />
              </div>
            </div>

            {/* Reasoning model */}
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Reasoning Model</label>
              <div className="flex items-center gap-2">
                <select
                  value={reasoningModel}
                  onChange={(e) => setReasoningModel(e.target.value)}
                  className="flex-1 text-sm border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-300 outline-none"
                >
                  {reasoningModels.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <HealthDot status={health[reasoningModel]} onClick={() => checkHealth(reasoningModel)} />
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center">
              Drag bubble to reposition • Click dot to ping
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function HealthDot({ status, onClick }) {
  const color = status === 'healthy' ? 'bg-green-400' :
                status === 'unhealthy' ? 'bg-red-400' :
                status === 'checking' ? 'bg-yellow-400 animate-pulse' :
                'bg-gray-300'
  return (
    <button onClick={onClick} className={`w-5 h-5 rounded-full ${color} flex items-center justify-center transition`} title="Check health">
      {status === 'healthy' && <Check size={10} className="text-white" />}
      {status === 'unhealthy' && <AlertCircle size={10} className="text-white" />}
    </button>
  )
}
