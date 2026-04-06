import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { experiments } from '../api'
import TreeViewer from '../components/TreeViewer'
import AlignmentViewer from '../components/AlignmentViewer'
import StatsCharts from '../components/StatsCharts'
import LogViewer from '../components/LogViewer'

const PIPELINE_STEPS = [
  { key: 'downloading', label: 'Downloading Sequences', icon: '📥' },
  { key: 'processing', label: 'Spark Feature Engineering', icon: '⚡' },
  { key: 'aligning', label: 'Multiple Sequence Alignment', icon: '🔗' },
  { key: 'building_tree', label: 'Building Phylogenetic Tree', icon: '🌳' },
  { key: 'complete', label: 'Analysis Complete', icon: '✅' },
]

const TABS = [
  { id: 'pipeline', label: 'Pipeline', icon: '🔄' },
  { id: 'logs', label: 'Live Logs', icon: '🖥️' },
  { id: 'tree', label: 'Phylogenetic Tree', icon: '🌳' },
  { id: 'alignment', label: 'Alignment', icon: '🧬' },
  { id: 'stats', label: 'Statistics', icon: '📊' },
]

export default function ExperimentDetail() {
  const { id } = useParams()
  const [exp, setExp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('pipeline')
  const [treeData, setTreeData] = useState(null)
  const [alignmentData, setAlignmentData] = useState(null)
  const [statsData, setStatsData] = useState(null)

  useEffect(() => {
    experiments.get(id).then((res) => {
      setExp(res.data)
      setLoading(false)
    })
  }, [id])

  // Load results data when experiment completes
  const loadResults = useCallback(async () => {
    if (!exp || exp.status !== 'complete') return
    try {
      const [tree, alignment, stats] = await Promise.all([
        experiments.getTree(id).catch(() => null),
        experiments.getAlignment(id).catch(() => null),
        experiments.getStats(id).catch(() => null),
      ])
      if (tree?.data) setTreeData(tree.data)
      if (alignment?.data) setAlignmentData(alignment.data)
      if (stats?.data) setStatsData(stats.data)
    } catch (e) {
      console.warn('Could not load result data:', e)
    }
  }, [exp, id])

  useEffect(() => { loadResults() }, [loadResults])

  const handleRun = async () => {
    const res = await experiments.run(id)
    setExp(res.data)
  }

  const handleStop = async () => {
    if (!confirm('Are you sure you want to stop this pipeline?')) return
    try {
      const res = await experiments.stop(id)
      setExp(res.data)
    } catch (e) {
      alert(`Stop failed: ${e.response?.data?.detail || e.message}`)
    }
  }

  // Auto-refresh while pipeline is running
  useEffect(() => {
    if (!exp) return
    const running = ['downloading', 'processing', 'aligning', 'building_tree']
    if (!running.includes(exp.status)) return
    const interval = setInterval(async () => {
      const res = await experiments.get(id)
      setExp(res.data)
      if (['complete', 'failed', 'cancelled'].includes(res.data.status)) {
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [exp?.status, id])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
    </div>
  )
  if (!exp) return (
    <div className="text-center py-12">
      <p className="text-gray-500 text-lg">Experiment not found</p>
      <Link to="/" className="text-sky-600 hover:underline mt-2 inline-block">Back to Dashboard</Link>
    </div>
  )

  const currentStepIndex = PIPELINE_STEPS.findIndex((s) => s.key === exp.status)
  const isComplete = exp.status === 'complete'

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3">
              <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors">&larr;</Link>
              <h1 className="text-2xl font-bold text-gray-900">{exp.name}</h1>
              <span className="px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold tracking-wide">
                UI v0.2
              </span>
              <StatusBadge status={exp.status} />
            </div>
            {exp.description && <p className="text-gray-500 mt-2 ml-8">{exp.description}</p>}
          </div>
          {(exp.status === 'created' || exp.status === 'failed' || exp.status === 'cancelled') && (
            <button
              onClick={handleRun}
              className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-2.5 rounded-lg hover:from-green-600 hover:to-emerald-700 font-medium shadow-sm transition-all hover:shadow-md"
            >
              ▶ Run Pipeline
            </button>
          )}
          {['downloading', 'processing', 'aligning', 'building_tree'].includes(exp.status) && (
            <button
              onClick={handleStop}
              className="bg-gradient-to-r from-red-500 to-rose-600 text-white px-6 py-2.5 rounded-lg hover:from-red-600 hover:to-rose-700 font-medium shadow-sm transition-all hover:shadow-md flex items-center gap-2"
            >
              ■ Stop Pipeline
            </button>
          )}
        </div>

        <div className="grid grid-cols-4 gap-4 mt-6">
          <InfoCard label="Query" value={exp.query} />
          <InfoCard label="Max Sequences" value={exp.max_sequences} />
          <InfoCard label="Organism" value={exp.organism || 'All'} />
          <InfoCard label="Created" value={new Date(exp.created_at).toLocaleDateString()} />
        </div>

        <div className="grid gap-4 mt-6 lg:grid-cols-2">
          <SequencePreviewCard selectedSequences={exp.selected_sequences} maxSequences={exp.max_sequences} />
          <AlignmentParamsCard alignmentParams={exp.alignment_params} />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 mb-6 bg-white rounded-t-xl px-2">
        {TABS.map((tab) => {
          const isResultTab = ['tree', 'alignment', 'stats'].includes(tab.id)
          const disabled = isResultTab && !isComplete
          return (
            <button
              key={tab.id}
              onClick={() => !disabled && setActiveTab(tab.id)}
              disabled={disabled}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-sky-500 text-sky-600'
                  : disabled
                  ? 'border-transparent text-gray-300 cursor-not-allowed'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'pipeline' && <PipelineTab exp={exp} currentStepIndex={currentStepIndex} />}
        {activeTab === 'logs' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Real-Time Pipeline Logs</h2>
            <LogViewer experimentId={parseInt(id)} status={exp.status} />
          </div>
        )}
        {activeTab === 'tree' && (
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Interactive Phylogenetic Tree</h2>
            {treeData?.newick ? (
              <TreeViewer newick={treeData.newick} />
            ) : (
              <PlaceholderMessage message="Tree data not available yet" />
            )}
            {treeData?.newick && (
              <details className="mt-4">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                  View raw Newick format
                </summary>
                <pre className="mt-2 bg-gray-50 p-3 rounded-lg text-xs font-mono overflow-x-auto">
                  {treeData.newick}
                </pre>
              </details>
            )}
          </div>
        )}
        {activeTab === 'alignment' && (
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Multiple Sequence Alignment</h2>
            {alignmentData?.fasta ? (
              <AlignmentViewer alignmentData={alignmentData.fasta} />
            ) : (
              <PlaceholderMessage message="Alignment data not available yet" />
            )}
          </div>
        )}
        {activeTab === 'stats' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Sequence Analysis & Statistics</h2>
            <StatsCharts
              features={statsData?.features}
              distanceMatrix={statsData?.distances}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const styles = {
    created: 'bg-gray-100 text-gray-600',
    downloading: 'bg-blue-100 text-blue-700 animate-pulse',
    processing: 'bg-purple-100 text-purple-700 animate-pulse',
    aligning: 'bg-indigo-100 text-indigo-700 animate-pulse',
    building_tree: 'bg-amber-100 text-amber-700 animate-pulse',
    cancelled: 'bg-orange-100 text-orange-700',
    complete: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${styles[status] || styles.created}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="font-medium text-gray-800 mt-1 truncate">{value}</p>
    </div>
  )
}

function PlaceholderMessage({ message }) {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <p>{message}</p>
    </div>
  )
}

function SequencePreviewCard({ selectedSequences, maxSequences }) {
  const sequences = selectedSequences || []

  return (
    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Codes To Process</p>
          <p className="font-semibold text-gray-900 mt-1">
            {sequences.length > 0 ? `${sequences.length} selected accessions` : 'No explicit accession preview saved'}
          </p>
        </div>
        <span className="text-xs text-gray-500 bg-white border rounded-full px-2.5 py-1">
          Max {maxSequences}
        </span>
      </div>

      {sequences.length > 0 ? (
        <div className="max-h-28 overflow-y-auto bg-white rounded-lg p-2 border border-gray-100 flex flex-wrap gap-1.5">
          {sequences.map((accession) => (
            <span key={accession} className="bg-sky-100 text-sky-700 text-xs px-2 py-1 rounded font-mono">
              {accession}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          This experiment was created without storing selected accession codes. Create a new run from the guided NCBI flow to keep the preview list.
        </p>
      )}
    </div>
  )
}

function AlignmentParamsCard({ alignmentParams }) {
  if (!alignmentParams) {
    return (
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
        <p className="text-xs text-gray-400 uppercase tracking-wide">Alignment Parameters</p>
        <p className="font-semibold text-gray-900 mt-1">No custom parameters saved</p>
        <p className="text-sm text-gray-500 mt-2">
          Use the AI-assisted alignment step in the new experiment wizard to persist method, gap penalties, matrix, and iterations.
        </p>
      </div>
    )
  }

  const items = [
    ['Method', alignmentParams.method],
    ['Matrix', alignmentParams.protein_weight_matrix],
    ['Gap Open', alignmentParams.gap_opening_penalty],
    ['Gap Extend', alignmentParams.gap_extension_penalty],
    ['Iterations', alignmentParams.max_iterations],
  ]

  return (
    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
      <p className="text-xs text-gray-400 uppercase tracking-wide">Alignment Parameters</p>
      <div className="grid grid-cols-2 gap-3 mt-3">
        {items.map(([label, value]) => (
          <div key={label} className="bg-white rounded-lg border border-gray-100 p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
            <p className="text-sm font-semibold text-gray-800 mt-1">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineTab({ exp, currentStepIndex }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-8">
      <h2 className="text-lg font-semibold mb-6 text-gray-800">Pipeline Progress</h2>
      <div className="space-y-3">
        {PIPELINE_STEPS.map((step, i) => {
          let state = 'pending'
          if (i < currentStepIndex) state = 'done'
          else if (i === currentStepIndex) state = exp.status === 'complete' ? 'done' : 'active'

          return (
            <div
              key={step.key}
              className={`flex items-center space-x-4 p-3 rounded-lg transition-colors ${
                state === 'active' ? 'bg-blue-50' : state === 'done' ? 'bg-green-50/50' : ''
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 ${
                  state === 'done'
                    ? 'bg-green-100'
                    : state === 'active'
                    ? 'bg-blue-100 animate-pulse'
                    : 'bg-gray-100'
                }`}
              >
                {step.icon}
              </div>
              <div className="flex-1">
                <p className={`font-medium ${
                  state === 'done' ? 'text-green-700' : state === 'active' ? 'text-blue-700' : 'text-gray-400'
                }`}>
                  {step.label}
                </p>
              </div>
              {state === 'done' && <span className="text-green-500 font-bold">✓</span>}
              {state === 'active' && (
                <span className="text-blue-500 text-sm flex items-center gap-1">
                  <span className="animate-spin h-3 w-3 border border-blue-500 border-t-transparent rounded-full" />
                  Running...
                </span>
              )}
            </div>
          )
        })}
      </div>

      {exp.status === 'failed' && exp.error_message && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">Pipeline Error</p>
          <p className="text-red-600 text-sm mt-1 font-mono">{exp.error_message}</p>
        </div>
      )}

      {exp.status === 'complete' && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 font-medium">Analysis Complete!</p>
          <p className="text-green-600 text-sm mt-1">
            All pipeline steps finished successfully. Use the tabs above to explore the results.
          </p>
        </div>
      )}
    </div>
  )
}
