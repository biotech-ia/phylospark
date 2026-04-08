import { useState, useEffect, useContext } from 'react'
import { Brain, RefreshCw, ChevronDown, ChevronUp, Cpu } from 'lucide-react'
import AIAnalysisLoader from './AIAnalysisLoader'
import { ai } from '../api'
import { ModelContext } from '../contexts/ModelContext'

/* ── Simple markdown renderer ── */
function SimpleMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-gray-800 mt-3 mb-1 text-sm">{line.slice(4)}</h4>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="font-bold text-gray-800 mt-4 mb-1">{line.slice(3)}</h3>)
    } else if (line.match(/^[-*] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} className="text-gray-600 text-sm">{lines[i].replace(/^[-*] /, '')}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 ml-1">{items}</ul>)
      continue
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(<p key={i} className="text-gray-600 text-sm leading-relaxed">{line}</p>)
    }
    i++
  }
  return <div>{elements}</div>
}

export default function InlineAIInsight({
  experimentId,
  scope,
  title = 'AI Analysis',
  gradientFrom = 'from-indigo-50',
  gradientTo = 'to-purple-50',
  autoLoad = true,
  steps,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(true)
  const modelCtx = useContext(ModelContext)

  const fetchAnalysis = async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      if (forceRefresh) {
        // Always use POST chart-analysis to generate/regenerate (works for all scopes)
        const resp = await ai.chartAnalysis(experimentId, {
          chart_type: scope,
          force_refresh: true,
          model: modelCtx?.reasoningModel,
        })
        setData(resp.data)
      } else {
        const resp = await ai.cachedAnalysis(experimentId, scope)
        setData(resp.data)
      }
    } catch (err) {
      // Pipeline not complete — hide silently
      if (err.response?.status === 400) {
        setData(null)
        setError(null)
        return
      }
      setError(err.response?.data?.detail || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const generateAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await ai.chartAnalysis(experimentId, {
        chart_type: scope,
        force_refresh: false,
        model: modelCtx?.reasoningModel,
      })
      setData(resp.data)
    } catch (err) {
      if (err.response?.status === 400) {
        setData(null)
        return
      }
      setError(err.response?.data?.detail || 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoLoad && experimentId && scope) {
      fetchAnalysis()
    }
  }, [experimentId, scope])

  if (!loading && !data && !error) return null

  const insight = data?.insight
  // Data loaded but no cached insight yet — show compact generate prompt
  const showGenerate = data && !data.cached && !insight && !loading && !error

  return (
    <div className={`rounded-xl bg-gradient-to-br ${gradientFrom} ${gradientTo} border border-gray-200 overflow-hidden`}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-white/30 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-indigo-500" />
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          {insight?.model_used && (
            <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full flex items-center gap-1">
              <Cpu size={10} /> {insight.model_used}
            </span>
          )}
          {data?.cached && (
            <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-600 rounded-full">cached</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); fetchAnalysis(true) }}
            className="p-1 hover:bg-white/50 rounded transition"
            title="Regenerate"
          >
            <RefreshCw size={14} className={`text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-3">
          {loading && (
            <AIAnalysisLoader
              loading={true}
              size="sm"
              title="Analyzing..."
              steps={steps || [
                { label: 'Processing data' },
                { label: 'Generating insights' },
              ]}
            />
          )}
          {error && (
            <div className="text-red-500 text-sm py-2">
              {error}
              <button onClick={() => fetchAnalysis()} className="ml-2 text-indigo-500 underline text-xs">Retry</button>
            </div>
          )}
          {showGenerate && (
            <div className="py-3 text-center">
              <button
                onClick={generateAnalysis}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
              >
                <Brain size={14} />
                Generate AI Analysis
              </button>
              <p className="text-xs text-gray-400 mt-1">Click to generate insights for this section</p>
            </div>
          )}
          {!loading && insight && (
            <div className="mt-1">
              <SimpleMarkdown text={insight.ai_response} />
              {insight.doi_references?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {insight.doi_references.map((ref, i) => (
                    <a
                      key={i}
                      href={ref.url || `https://doi.org/${ref.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition"
                      title={ref.title || ref.doi}
                    >
                      {ref.validated ? '✓' : '⚠'} {ref.doi.length > 30 ? ref.doi.slice(0, 30) + '…' : ref.doi}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
