import { useState } from 'react'
import { Brain, Sparkles, Loader2, FileText, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import DOIReferences, { DOIBadge } from './DOIReferences'
import api from '../api'

function SimpleMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold text-gray-800 mt-4 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-gray-800 mt-5 mb-2">{line.slice(3)}</h2>
        if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-gray-900 mt-5 mb-2">{line.slice(2)}</h1>
        if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (line.match(/^\d+\.\s/)) return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (line.trim() === '') return <br key={i} />
        return <p key={i} className="text-sm mb-1">{formatInline(line)}</p>
      })}
    </div>
  )
}

function formatInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    return part
  })
}

export default function StatsAIPanel({ experimentId }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const generateReport = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.ai.statsReport(experimentId, {})
      setReport(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate stats report')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-cyan-50 to-blue-50 border-b">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <Brain size={16} className="text-cyan-500" />
          AI Statistics Analysis
          <span className="text-[10px] bg-cyan-100 text-cyan-600 px-2 py-0.5 rounded-full">DeepSeek</span>
        </h3>
      </div>

      <div className="p-4">
        {!report && !loading && (
          <div className="text-center py-8">
            <Sparkles size={32} className="mx-auto text-cyan-300 mb-3" />
            <p className="text-sm text-gray-500 mb-4">
              Generate an AI-powered deep analysis of your sequence statistics,
              amino acid composition, physicochemical properties, and evolutionary distances
              with DOI-validated references.
            </p>
            <button onClick={generateReport}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg text-sm font-medium hover:from-cyan-600 hover:to-blue-600 transition-all shadow-lg shadow-cyan-200 flex items-center gap-2 mx-auto">
              <Brain size={16} />
              Generate Stats Report
            </button>
            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <Loader2 size={28} className="animate-spin text-cyan-500 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Analyzing statistics with AI...</p>
            <p className="text-[10px] text-gray-400 mt-1">This may take 30-60 seconds</p>
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <FileText size={14} className="text-cyan-500" />
                Sequence Statistics Report
                {report.doi_references && <DOIBadge references={report.doi_references} />}
              </h4>
              <div className="flex items-center gap-2">
                <button onClick={() => setExpanded(!expanded)}
                  className="text-[10px] flex items-center gap-1 text-cyan-600 hover:text-cyan-800">
                  {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {expanded ? 'Collapse' : 'Expand'}
                </button>
                <button onClick={generateReport}
                  className="text-[10px] flex items-center gap-1 text-gray-500 hover:text-gray-700">
                  <RefreshCw size={10} /> Regenerate
                </button>
              </div>
            </div>

            <div className={`${expanded ? '' : 'max-h-96'} overflow-y-auto rounded-lg bg-gray-50 p-4 border`}>
              <SimpleMarkdown text={report.analysis} />
            </div>

            {report.doi_references && <DOIReferences references={report.doi_references} />}
          </div>
        )}
      </div>
    </div>
  )
}
