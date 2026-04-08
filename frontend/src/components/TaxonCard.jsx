import { useState, useEffect } from 'react'
import { X, Sparkles, ChevronDown, ChevronUp, RefreshCw, Dna, Info, Brain, Clock, Send } from 'lucide-react'
import DOIReferences, { DOIBadge } from './DOIReferences'

/* ── Markdown renderer ── */
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
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="font-bold text-gray-900 mt-4 mb-2 text-base">{parseBold(line.slice(2))}</h2>)
    } else if (line.match(/^[-*] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} className="text-gray-600 text-sm">{parseBold(lines[i].replace(/^[-*] /, ''))}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 ml-2">{items}</ul>)
      continue
    } else if (line.match(/^\d+\. /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={i} className="text-gray-600 text-sm">{parseBold(lines[i].replace(/^\d+\. /, ''))}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 ml-2">{items}</ol>)
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
  const [tab, setTab] = useState('info') // 'info' | 'ai'
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const taxonInsights = (insights || []).filter(i => i.accession === taxon.name)
  const latestInsight = taxonInsights[0]

  // Auto-switch to AI tab when loading starts or a new insight arrives
  useEffect(() => {
    if (loading) setTab('ai')
  }, [loading])

  useEffect(() => {
    if (latestInsight) setTab('ai')
  }, [taxonInsights.length])

  const handleAi = () => {
    onAiRequest(taxon.name, prompt || null)
    setPrompt('')
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-end pointer-events-none"
      onClick={e => e.stopPropagation()}>
      {/* Subtle backdrop on the right half */}
      <div className="absolute inset-0 bg-black/10 pointer-events-auto" onClick={onClose} />

      <div className="pointer-events-auto mr-4 w-[520px] max-h-[calc(100vh-4rem)] flex flex-col
        bg-white rounded-2xl shadow-2xl border border-gray-200/80 overflow-hidden animate-slide-in relative z-10"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 px-6 py-5 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dna size={20} />
              <span className="text-xs font-medium uppercase tracking-wider opacity-80">Taxon Info</span>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
              <X size={18} />
            </button>
          </div>
          <h3 className="text-xl font-bold mt-3 font-mono tracking-wide">{taxon.name}</h3>
          {meta && (
            <p className="text-sm text-white/80 mt-1 italic">{meta.organism}</p>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 shrink-0 bg-gray-50">
          <button onClick={() => setTab('info')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all border-b-2 ${
              tab === 'info'
                ? 'border-blue-500 text-blue-600 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Info size={14} /> Details
          </button>
          <button onClick={() => setTab('ai')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all border-b-2 ${
              tab === 'ai'
                ? 'border-amber-500 text-amber-600 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Brain size={14} /> AI Analysis
            {loading && <RefreshCw size={12} className="animate-spin text-amber-500" />}
            {taxonInsights.length > 0 && !loading && (
              <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {taxonInsights.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab content (scrollable) */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── INFO TAB ── */}
          {tab === 'info' && (
            <div className="p-6">
              {meta ? (
                <div className="space-y-1">
                  <MetaCard icon="🧬" label="Organism" value={meta.organism} />
                  <MetaCard icon="🔬" label="Protein" value={meta.protein_name} />
                  <MetaCard icon="📏" label="Sequence Length" value={meta.length ? `${meta.length} amino acids` : null} />
                  <MetaCard icon="🌿" label="Branch Length" value={taxon.len?.toFixed(6)} />
                  {meta.taxonomy && <MetaCard icon="🏷️" label="Taxonomy ID" value={String(meta.taxonomy).replace(/IntegerElement\((\d+).*/, '$1')} />}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Dna size={32} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm text-gray-400">No NCBI metadata available for this taxon</p>
                </div>
              )}

              {/* Quick AI button on info tab */}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <button onClick={() => { setTab('ai'); if (!latestInsight && !loading) handleAi() }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium
                    bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:from-amber-500 hover:to-orange-600
                    shadow-sm hover:shadow-md transition-all">
                  <Sparkles size={16} />
                  {latestInsight ? 'View AI Analysis' : 'Analyze with AI'}
                </button>
              </div>
            </div>
          )}

          {/* ── AI TAB ── */}
          {tab === 'ai' && (
            <div className="flex flex-col h-full">
              {/* AI input area */}
              <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-amber-50/50 to-orange-50/50 shrink-0">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !loading) { e.preventDefault(); handleAi() }}}
                      placeholder="Ask about this organism... (or just click analyze)"
                      rows={2}
                      disabled={loading}
                      className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl resize-none
                        focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300
                        disabled:opacity-50 disabled:cursor-wait"
                    />
                  </div>
                  <button onClick={handleAi} disabled={loading}
                    className={`self-end px-4 py-2.5 rounded-xl transition-all shrink-0 ${
                      loading
                        ? 'bg-gray-200 text-gray-400 cursor-wait'
                        : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:from-amber-500 hover:to-orange-600 shadow-sm hover:shadow-md'
                    }`}>
                    {loading
                      ? <RefreshCw size={18} className="animate-spin" />
                      : <Send size={18} />}
                  </button>
                </div>
              </div>

              {/* Loading animation */}
              {loading && !latestInsight && (
                <div className="px-6 py-12 text-center">
                  <div className="inline-flex items-center gap-3 px-5 py-3 bg-amber-50 rounded-2xl border border-amber-200">
                    <RefreshCw size={18} className="animate-spin text-amber-500" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-amber-700">Analyzing {meta?.organism || taxon.name}...</p>
                      <p className="text-xs text-amber-600/70">DeepSeek AI is generating phylogenetic insights</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Latest insight */}
              {latestInsight && (
                <div className="p-5">
                  <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                    <SimpleMarkdown text={latestInsight.ai_response} />
                    {latestInsight.doi_references?.length > 0 && (
                      <DOIReferences references={latestInsight.doi_references} />
                    )}
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                      <Brain size={12} />
                      <span>{latestInsight.model_used}</span>
                      <span>·</span>
                      <Clock size={10} />
                      <span>{new Date(latestInsight.created_at).toLocaleString()}</span>
                      {latestInsight.doi_references?.length > 0 && <DOIBadge references={latestInsight.doi_references} />}
                      {latestInsight.user_prompt && (
                        <span className="ml-auto italic max-w-[200px] truncate">&ldquo;{latestInsight.user_prompt}&rdquo;</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* No insights yet (not loading) */}
              {!latestInsight && !loading && (
                <div className="text-center py-12 px-6">
                  <div className="inline-block p-4 rounded-full bg-amber-50 mb-4">
                    <Sparkles size={32} className="text-amber-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-700">No analysis yet</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">Enter</kbd> or click the send button to analyze this taxon
                  </p>
                </div>
              )}

              {/* History */}
              {taxonInsights.length > 1 && (
                <div className="px-5 pb-5">
                  <button onClick={() => setShowHistory(!showHistory)}
                    className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 mb-3 transition-colors">
                    {showHistory ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    <span className="font-medium">{taxonInsights.length - 1} previous analysis{taxonInsights.length > 2 ? 'es' : ''}</span>
                  </button>
                  {showHistory && (
                    <div className="space-y-3">
                      {taxonInsights.slice(1).map(ins => (
                        <details key={ins.id} className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
                          <summary className="px-4 py-2.5 text-xs text-gray-500 cursor-pointer hover:bg-gray-100 flex items-center gap-2">
                            <Clock size={10} />
                            {new Date(ins.created_at).toLocaleString()}
                            {ins.user_prompt && <span className="text-gray-400 italic ml-1">— &ldquo;{ins.user_prompt}&rdquo;</span>}
                          </summary>
                          <div className="px-4 py-3 border-t border-gray-200 bg-white">
                            <SimpleMarkdown text={ins.ai_response} />
                            {ins.doi_references?.length > 0 && <DOIReferences references={ins.doi_references} />}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetaCard({ icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
      <span className="text-lg shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</p>
        <p className="text-sm text-gray-800 font-medium mt-0.5 break-words">{value}</p>
      </div>
    </div>
  )
}
