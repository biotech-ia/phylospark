import { useState, useEffect, useRef } from 'react'
import { connectExperimentWS, experiments } from '../api'

const LEVEL_STYLES = {
  info: 'text-sky-300',
  warning: 'text-yellow-400',
  error: 'text-red-400',
  success: 'text-green-400',
  debug: 'text-gray-500',
}

export default function LogViewer({ experimentId, status }) {
  const [logs, setLogs] = useState([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [loadedHistory, setLoadedHistory] = useState(false)
  const containerRef = useRef(null)
  const wsRef = useRef(null)

  // Load persisted logs from DB on mount (always — even for finished experiments)
  useEffect(() => {
    if (!experimentId) return
    experiments.getLogs(experimentId).then((res) => {
      const dbLogs = res.data?.logs || []
      if (dbLogs.length > 0) {
        setLogs(dbLogs)
      }
      setLoadedHistory(true)
    }).catch(() => setLoadedHistory(true))
  }, [experimentId])

  // Connect WebSocket only while pipeline is actively running
  useEffect(() => {
    if (!experimentId || !loadedHistory) return

    const running = ['downloading', 'processing', 'aligning', 'building_tree']
    if (!running.includes(status)) return

    const ws = connectExperimentWS(experimentId, (data) => {
      if (data.type === 'log') {
        setLogs((prev) => {
          // Dedupe by checking if this message+timestamp already exists
          const last = prev[prev.length - 1]
          if (last && last.message === data.message && last.timestamp === data.timestamp) return prev
          return [...prev, data]
        })
      } else if (data.type === 'status') {
        // Status updates handled by parent
      } else if (data.type === 'complete') {
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: 'success',
          step: 'pipeline',
          message: data.message || 'Pipeline completed!',
        }])
      } else if (data.type === 'error') {
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: 'error',
          step: 'pipeline',
          message: data.message || 'Pipeline error',
        }])
      }
    })

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    wsRef.current = ws

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [experimentId, status])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
  }

  const formatTime = (ts) => {
    try {
      return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
    } catch {
      return ts
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-gray-400 text-xs font-mono ml-2">PhyloSpark Pipeline — Experiment #{experimentId}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs flex items-center gap-1 ${connected ? 'text-green-400' : 'text-gray-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
            {connected ? 'Live' : 'Disconnected'}
          </span>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="font-mono text-xs leading-5 p-4 h-[400px] overflow-y-auto"
      >
        {logs.length === 0 ? (
          <div className="text-gray-600 flex items-center gap-2">
            <span className="animate-pulse">▌</span>
            Waiting for pipeline logs...
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex hover:bg-gray-800/50 px-1 -mx-1 rounded">
              <span className="text-gray-600 select-none shrink-0 w-20">{formatTime(log.timestamp)}</span>
              {log.step && (
                <span className="text-purple-400 select-none shrink-0 w-28 truncate">[{log.step}]</span>
              )}
              <span className={LEVEL_STYLES[log.level] || 'text-gray-300'}>{log.message}</span>
            </div>
          ))
        )}
        {!autoScroll && logs.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true)
              if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight
            }}
            className="fixed bottom-4 right-4 bg-sky-600 text-white text-xs px-3 py-1 rounded-full shadow-lg"
          >
            ↓ Scroll to bottom
          </button>
        )}
      </div>
    </div>
  )
}
