import { useState } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

/* Lightweight markdown renderer (same as TaxonCard) */
function SimpleMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-gray-800 mt-3 mb-1 text-sm">{parseBold(line.slice(4))}</h4>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="font-bold text-gray-800 mt-4 mb-1">{parseBold(line.slice(3))}</h3>)
    } else if (line.match(/^[-*] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} className="text-gray-600 text-sm">{parseBold(lines[i].replace(/^[-*] /, ''))}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 ml-1">{items}</ul>)
      continue
    } else if (line.match(/^\d+\. /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={i} className="text-gray-600 text-sm">{parseBold(lines[i].replace(/^\d+\. /, ''))}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 ml-1">{items}</ol>)
      continue
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    } else {
      elements.push(<p key={i} className="text-gray-600 text-sm leading-relaxed">{parseBold(line)}</p>)
    }
    i++
  }
  return <div>{elements}</div>
}
function parseBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-700">{p.slice(2, -2)}</strong>
      : p
  )
}

export default function TreeInsightPanel({ insights, onTreeAi, loading }) {
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const treeInsights = (insights || []).filter(i => i.scope === 'tree')
  const latest = treeInsights[0]

  if (!latest && !loading) return null

  const handleAi = () => {
    onTreeAi(prompt || null)
    setPrompt('')
    setPromptOpen(false)
  }

  return (
    <div className="mt-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-amber-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-amber-500" />
          <span className="font-semibold text-gray-800">AI Tree Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          {treeInsights.length > 1 && (
            <button onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              {showHistory ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
              {treeInsights.length} analyses
            </button>
          )}
          <button
            onClick={() => promptOpen ? handleAi() : setPromptOpen(true)}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all
              ${loading
                ? 'bg-gray-200 text-gray-400 cursor-wait'
                : 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'}`}
          >
            {loading ? <><RefreshCw size={12} className="animate-spin" /> Analyzing...</>
                     : <><Sparkles size={12} /> {latest ? 'Re-analyze' : 'Analyze'}</>}
          </button>
        </div>
      </div>

      {promptOpen && !loading && (
        <div className="px-5 py-3 border-b border-amber-200/50 bg-white/50">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Optional: Ask something specific about this phylogenetic tree..."
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none
              focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setPromptOpen(false)}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={handleAi}
              className="px-4 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium">
              Run AI
            </button>
          </div>
        </div>
      )}

      {latest && (
        <div className="px-5 py-4">
          <SimpleMarkdown text={latest.ai_response} />
          <p className="text-[10px] text-gray-400 mt-3 border-t border-amber-200/50 pt-2">
            {latest.model_used} · {new Date(latest.created_at).toLocaleString()}
            {latest.user_prompt && <> · Prompt: &ldquo;{latest.user_prompt}&rdquo;</>}
          </p>
        </div>
      )}

      {showHistory && treeInsights.length > 1 && (
        <div className="px-5 pb-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Previous Analyses</p>
          {treeInsights.slice(1).map(ins => (
            <details key={ins.id} className="bg-white/60 border border-amber-200/50 rounded-xl p-3">
              <summary className="text-xs text-gray-500 cursor-pointer">
                {new Date(ins.created_at).toLocaleString()}
                {ins.user_prompt && ` — "${ins.user_prompt}"`}
              </summary>
              <div className="mt-2">
                <SimpleMarkdown text={ins.ai_response} />
              </div>
            </details>
          ))}
        </div>
      )}

      {loading && !latest && (
        <div className="px-5 py-8 text-center">
          <RefreshCw size={20} className="mx-auto animate-spin text-amber-400 mb-2" />
          <p className="text-sm text-gray-500">Analyzing phylogenetic tree with AI...</p>
        </div>
      )}
    </div>
  )
}
