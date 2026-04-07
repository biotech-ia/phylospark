import { useState, useEffect, useRef, useMemo } from 'react'
import { connectExperimentWS } from '../api'

/* ═══════════════════════════════════════════════════════════════
   PIPELINE MONITOR — Real-time Spark + Airflow visibility
   ═══════════════════════════════════════════════════════════════ */

const STEPS = [
  {
    key: 'download', label: 'Download Sequences', icon: '📥',
    engine: 'Python', engineIcon: '🐍', color: 'blue',
    desc: 'Fetching protein sequences from NCBI Entrez database',
  },
  {
    key: 'validate', label: 'Validate & Clean', icon: '🧹',
    engine: 'Python', engineIcon: '🐍', color: 'blue',
    desc: 'QC filtering: remove short/ambiguous sequences',
  },
  {
    key: 'features', label: 'Feature Engineering', icon: '⚡',
    engine: 'Apache Spark', engineIcon: '🔥', color: 'orange',
    desc: 'Distributed amino acid composition, k-mers, molecular weight via Spark RDD',
  },
  {
    key: 'distances', label: 'Distance Matrix', icon: '📐',
    engine: 'Apache Spark', engineIcon: '🔥', color: 'orange',
    desc: 'Pairwise Euclidean distance computation parallelized across Spark partitions',
  },
  {
    key: 'alignment', label: 'Sequence Alignment', icon: '🔗',
    engine: 'MAFFT', engineIcon: '🧬', color: 'indigo',
    desc: 'Multiple sequence alignment using MAFFT (progressive method)',
  },
  {
    key: 'tree', label: 'Phylogenetic Tree', icon: '🌳',
    engine: 'BioPython', engineIcon: '🐍', color: 'green',
    desc: 'Neighbor-Joining tree construction from distance matrix',
  },
  {
    key: 'finalize', label: 'Finalize Results', icon: '✅',
    engine: 'MinIO + PostgreSQL', engineIcon: '💾', color: 'gray',
    desc: 'Upload artifacts to MinIO object storage and save metadata',
  },
]

/**
 * Map experiment status to current step key
 */
function statusToStepKey(status) {
  const map = {
    downloading: 'download',
    processing: 'features',   // processing covers features + distances
    aligning: 'alignment',
    building_tree: 'tree',
    complete: 'finalize',
  }
  return map[status] || null
}

/**
 * Parse Spark metrics from log messages
 */
function parseSparkMetrics(logs) {
  const metrics = {
    partitions: null,
    records: null,
    mapTime: null,
    totalTime: null,
    avgDistance: null,
    totalPairs: null,
    avgLength: null,
    sparkApp: null,
    cores: null,
  }

  for (const log of logs) {
    const m = log.message || ''
    // SparkSession info
    let match = m.match(/App:\s*(\S+).*Cores:\s*(\d+)/)
    if (match) { metrics.sparkApp = match[1]; metrics.cores = parseInt(match[2]) }
    // Partitions
    match = m.match(/(\d+)\s*Spark partitions/)
    if (match) metrics.partitions = parseInt(match[1])
    // RDD records
    match = m.match(/(\d+)\s*records/)
    if (match) metrics.records = parseInt(match[1])
    // Map time
    match = m.match(/map:\s*([\d.]+)s/)
    if (match) metrics.mapTime = parseFloat(match[1])
    // Total time
    match = m.match(/Total:\s*([\d.]+)s/)
    if (match) metrics.totalTime = parseFloat(match[1])
    // Distance pairs
    match = m.match(/([\d,]+)\s*pairs/)
    if (match) metrics.totalPairs = parseInt(match[1].replace(',', ''))
    // Avg distance
    match = m.match(/Avg dist:\s*([\d.]+)/)
    if (match) metrics.avgDistance = parseFloat(match[1])
    // Avg length
    match = m.match(/Avg length:\s*([\d.]+)/)
    if (match) metrics.avgLength = parseFloat(match[1])
  }
  return metrics
}

export default function PipelineMonitor({ experimentId, status, logs: externalLogs }) {
  const [logs, setLogs] = useState(externalLogs || [])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const logsEndRef = useRef(null)

  // Connect WebSocket for live logs
  useEffect(() => {
    const running = ['downloading', 'processing', 'aligning', 'building_tree']
    if (!running.includes(status)) return

    const ws = connectExperimentWS(experimentId, (data) => {
      if (data.type === 'log') {
        setLogs(prev => [...prev, data])
      }
    })
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    wsRef.current = ws
    return () => ws.close()
  }, [experimentId, status])

  // Also accept external logs
  useEffect(() => {
    if (externalLogs?.length) setLogs(externalLogs)
  }, [externalLogs])

  // Derive step states from logs and status
  const stepStates = useMemo(() => {
    const states = {}
    const currentKey = statusToStepKey(status)

    // Mark steps based on log analysis
    const stepsWithLogs = new Set()
    const completedSteps = new Set()

    for (const log of logs) {
      if (log.step) stepsWithLogs.add(log.step)
      if (log.level === 'success' && log.step) completedSteps.add(log.step)
    }

    // The 'processing' status covers both features and distances
    for (const step of STEPS) {
      if (completedSteps.has(step.key)) {
        states[step.key] = 'done'
      } else if (step.key === currentKey) {
        states[step.key] = 'active'
      } else if (stepsWithLogs.has(step.key)) {
        // Has logs but no success → might be active or done
        states[step.key] = completedSteps.has(step.key) ? 'done' : 'active'
      } else {
        states[step.key] = 'pending'
      }
    }

    // If status is complete, mark all done
    if (status === 'complete') {
      for (const step of STEPS) states[step.key] = 'done'
    }

    return states
  }, [logs, status])

  // Parse Spark metrics from feature/distance logs
  const sparkFeatureMetrics = useMemo(() =>
    parseSparkMetrics(logs.filter(l => l.step === 'features')),
  [logs])

  const sparkDistanceMetrics = useMemo(() =>
    parseSparkMetrics(logs.filter(l => l.step === 'distances')),
  [logs])

  // Step-specific logs for the expanded view
  const [expandedStep, setExpandedStep] = useState(null)
  const stepLogs = useMemo(() => {
    if (!expandedStep) return []
    return logs.filter(l => l.step === expandedStep)
  }, [logs, expandedStep])

  const isComplete = status === 'complete'
  const isFailed = status === 'failed'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🔬</div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Pipeline Execution Monitor</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Real-time view of Spark, MAFFT, and BioPython processing engines
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Live
              </span>
            )}
            {isComplete && (
              <span className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full font-medium">
                ✅ All steps complete
              </span>
            )}
            {isFailed && (
              <span className="text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded-full font-medium">
                ❌ Pipeline failed
              </span>
            )}
          </div>
        </div>

        {/* Pipeline Stepper */}
        <div className="space-y-2">
          {STEPS.map((step, i) => {
            const state = stepStates[step.key] || 'pending'
            const isExpanded = expandedStep === step.key
            const isSpark = step.engine === 'Apache Spark'
            const metrics = step.key === 'features' ? sparkFeatureMetrics
                          : step.key === 'distances' ? sparkDistanceMetrics
                          : null

            return (
              <div key={step.key}>
                {/* Step Row */}
                <div
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all
                    ${state === 'active' ? 'bg-blue-50 ring-1 ring-blue-200' :
                      state === 'done' ? 'bg-green-50/50 hover:bg-green-50' :
                      'hover:bg-gray-50'}`}
                  onClick={() => setExpandedStep(isExpanded ? null : step.key)}
                >
                  {/* Step icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0
                    ${state === 'done' ? 'bg-green-100' :
                      state === 'active' ? 'bg-blue-100 animate-pulse' : 'bg-gray-100'}`}>
                    {step.icon}
                  </div>

                  {/* Step info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium text-sm
                        ${state === 'done' ? 'text-green-700' :
                          state === 'active' ? 'text-blue-700' : 'text-gray-400'}`}>
                        {step.label}
                      </span>
                      {/* Engine badge */}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                        ${isSpark ? 'bg-orange-100 text-orange-700' :
                          step.color === 'indigo' ? 'bg-indigo-100 text-indigo-700' :
                          step.color === 'green' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-gray-100 text-gray-600'}`}>
                        {step.engineIcon} {step.engine}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{step.desc}</p>
                  </div>

                  {/* Status indicator */}
                  <div className="shrink-0">
                    {state === 'done' && <span className="text-green-500 font-bold">✓</span>}
                    {state === 'active' && (
                      <span className="flex items-center gap-1 text-blue-500 text-xs">
                        <span className="animate-spin h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full" />
                        Running
                      </span>
                    )}
                    {state === 'pending' && <span className="text-gray-300 text-xs">—</span>}
                  </div>
                </div>

                {/* Spark Metrics Bar (inline, for Spark steps) */}
                {isSpark && metrics && (metrics.partitions || metrics.totalTime) && (
                  <div className="ml-[52px] mt-1 mb-1">
                    <div className="flex flex-wrap gap-2">
                      {metrics.cores && (
                        <MetricPill label="Cores" value={metrics.cores} color="orange" />
                      )}
                      {metrics.partitions && (
                        <MetricPill label="Partitions" value={metrics.partitions} color="orange" />
                      )}
                      {metrics.records && (
                        <MetricPill label="Records" value={metrics.records} color="blue" />
                      )}
                      {metrics.totalPairs && (
                        <MetricPill label="Pairs" value={metrics.totalPairs.toLocaleString()} color="blue" />
                      )}
                      {metrics.mapTime !== null && (
                        <MetricPill label="Map Time" value={`${metrics.mapTime}s`} color="purple" />
                      )}
                      {metrics.totalTime !== null && (
                        <MetricPill label="Total" value={`${metrics.totalTime}s`} color="green" />
                      )}
                      {metrics.avgDistance !== null && (
                        <MetricPill label="Avg Dist" value={metrics.avgDistance.toFixed(4)} color="gray" />
                      )}
                      {metrics.avgLength !== null && (
                        <MetricPill label="Avg Length" value={Math.round(metrics.avgLength)} color="gray" />
                      )}
                    </div>
                  </div>
                )}

                {/* Expanded: Step Logs */}
                {isExpanded && stepLogs.length > 0 && (
                  <div className="ml-[52px] mt-1 mb-2 bg-gray-900 rounded-lg p-3 max-h-48 overflow-y-auto">
                    {stepLogs.map((log, li) => (
                      <div key={li} className="flex gap-2 text-xs font-mono leading-relaxed">
                        <span className="text-gray-600 shrink-0">
                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '—'}
                        </span>
                        <span className={
                          log.level === 'success' ? 'text-green-400' :
                          log.level === 'error' ? 'text-red-400' :
                          log.level === 'warning' ? 'text-yellow-400' :
                          'text-sky-300'
                        }>
                          {log.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Spark Engine Summary Card */}
      {(sparkFeatureMetrics.totalTime || sparkDistanceMetrics.totalTime) && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl border border-orange-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🔥</span>
            <h3 className="font-semibold text-orange-800">Apache Spark Summary</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SparkStat
              label="Feature Engineering"
              value={sparkFeatureMetrics.totalTime ? `${sparkFeatureMetrics.totalTime}s` : '—'}
              sub={sparkFeatureMetrics.records ? `${sparkFeatureMetrics.records} sequences` : ''}
            />
            <SparkStat
              label="Distance Matrix"
              value={sparkDistanceMetrics.totalTime ? `${sparkDistanceMetrics.totalTime}s` : '—'}
              sub={sparkDistanceMetrics.totalPairs ? `${sparkDistanceMetrics.totalPairs.toLocaleString()} pairs` : ''}
            />
            <SparkStat
              label="Partitions Used"
              value={sparkDistanceMetrics.partitions || sparkFeatureMetrics.partitions || '—'}
              sub={`${sparkFeatureMetrics.cores || '?'} CPU cores`}
            />
            <SparkStat
              label="Avg Distance"
              value={sparkDistanceMetrics.avgDistance?.toFixed(4) || '—'}
              sub={sparkDistanceMetrics.avgDistance ? 'Euclidean' : ''}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function MetricPill({ label, value, color }) {
  const colors = {
    orange: 'bg-orange-100 text-orange-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    green: 'bg-green-100 text-green-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[color] || colors.gray}`}>
      <span className="opacity-60">{label}:</span>
      <span className="font-bold">{value}</span>
    </span>
  )
}

function SparkStat({ label, value, sub }) {
  return (
    <div className="bg-white/70 rounded-lg p-3 border border-orange-100">
      <p className="text-[10px] text-orange-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-lg font-bold text-orange-900 mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-orange-400 mt-0.5">{sub}</p>}
    </div>
  )
}
