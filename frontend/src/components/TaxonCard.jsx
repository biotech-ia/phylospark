import { useState } from 'react'
import { X, Sparkles, ChevronDown, ChevronUp, RefreshCw, Dna } from 'lucide-react'

/* Lightweight markdown-ish renderer — handles **bold**, headers, lists, paragraphs */
function SimpleMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-gray-800 mt-3 mb-1 text-sm">{parseBold(line.slice(4))}</h4>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="font-bold text-gray-800 mt-4 mb-1">{parseBold(line.slice(3))}</h3>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="font-bold text-gray-900 mt-4 mb-2 text-base">{parseBold(line.slice(2))}</h2>)
    } else if (line.match(/^[-*] /)) {
      // Collect list items
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

export default function TaxonCard({ taxon, meta, insights, onClose, onAiRequest, loading }) {
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const taxonInsights = (insights || []).filter(i => i.accession === taxon.name)
  const latestInsight = taxonInsights[0]

  const handleAi = () => {
    onAiRequest(taxon.name, prompt || null)
    setPrompt('')
    setPromptOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-end pointer-events-none">
      <div className="pointer-events-auto m-4 mt-16 w-[420px] max-h-[calc(100vh-6rem)] flex flex-col
        bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-slide-in">

        {/* Header */}
        <div className="bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-4 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dna size={18} />
              <span className="text-xs font-medium uppercase tracking-wider opacity-80">Taxon Info</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/20 transition-colors">
              <X size={16} />
            </button>
          </div>
          <h3 className="text-lg font-bold mt-2 font-mono">{taxon.name}</h3>
          {meta && (
            <p className="text-sm text-white/80 mt-1">{meta.organism}</p>
          )}
        </div>

        {/* Metadata */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          {meta ? (
            <div className="space-y-3">
              <MetaRow label="Organism" value={meta.organism} />
              <MetaRow label="Protein" value={meta.protein_name} />
              <MetaRow label="Length" value={meta.length ? `${meta.length} aa` : null} />
              <MetaRow label="Branch" value={taxon.len?.toFixed(6)} />
              {meta.taxonomy && <MetaRow label="Tax ID" value={meta.taxonomy} />}
            </div>
          ) : (
            <div className="text-sm text-gray-400 text-center py-2">
              No metadata available
            </div>
          )}
        </div>

        {/* AI Section */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-500" />
              <span className="text-sm font-semibold text-gray-700">AI Analysis</span>
            </div>
            {taxonInsights.length > 1 && (
              <button onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                {showHistory ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                {taxonInsights.length} saved
              </button>
            )}
          </div>

          {/* Prompt input toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => !loading && (promptOpen ? handleAi() : setPromptOpen(true))}
              disabled={loading}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all
                ${loading
                  ? 'bg-gray-100 text-gray-400 cursor-wait'
                  : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:from-amber-500 hover:to-orange-600 shadow-sm hover:shadow-md'
                }`}
            >
              {loading ? (
                <><RefreshCw size={14} className="animate-spin" /> Analyzing...</>
              ) : (
                <><Sparkles size={14} /> {latestInsight ? 'Re-analyze' : 'Analyze with AI'}</>
              )}
            </button>
          </div>

          {promptOpen && !loading && (
            <div className="mt-3">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Optional: Ask something specific about this organism..."
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
        </div>

        {/* AI Response (scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {latestInsight ? (
            <div>
              <SimpleMarkdown text={latestInsight.ai_response} />
              <p className="text-[10px] text-gray-300 mt-4 border-t pt-2">
                {latestInsight.model_used} · {new Date(latestInsight.created_at).toLocaleString()}
                {latestInsight.user_prompt && (
                  <><br/>Prompt: &ldquo;{latestInsight.user_prompt}&rdquo;</>
                )}
              </p>
            </div>
          ) : !loading ? (
            <div className="text-center text-gray-400 py-8">
              <Sparkles size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Click &ldquo;Analyze with AI&rdquo; to get insights about this organism</p>
            </div>
          ) : null}

          {/* History */}
          {showHistory && taxonInsights.length > 1 && (
            <div className="mt-4 border-t pt-4 space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Previous Analyses</p>
              {taxonInsights.slice(1).map(ins => (
                <details key={ins.id} className="border rounded-xl p-3">
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
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-gray-400 uppercase tracking-wide w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-700 font-medium leading-snug">{value}</span>
    </div>
  )
}
