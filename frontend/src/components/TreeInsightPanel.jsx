import { useState, useMemo } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Brain, Send, Clock, TreePine, BarChart3, Dna, Layers } from 'lucide-react'
import Plot from 'react-plotly.js'

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

export default function TreeInsightPanel({ insights, onTreeAi, loading, taxonMeta, treeStats }) {
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [expandedAi, setExpandedAi] = useState(true)

  const treeInsights = (insights || []).filter(i => i.scope === 'tree')
  const latest = treeInsights[0]

  const handleAi = () => {
    onTreeAi(prompt || null)
    setPrompt('')
  }

  // Compute chart data from taxonMeta
  const charts = useMemo(() => {
    if (!taxonMeta || Object.keys(taxonMeta).length === 0) return null
    const taxa = Object.values(taxonMeta)

    // Genus distribution
    const genusCounts = {}
    taxa.forEach(t => {
      if (!t.organism) return
      const genus = t.organism.split(' ')[0]
      genusCounts[genus] = (genusCounts[genus] || 0) + 1
    })
    const sortedGenera = Object.entries(genusCounts).sort((a, b) => b[1] - a[1])
    const topGenera = sortedGenera.slice(0, 10)

    // Protein length distribution
    const lengths = taxa.map(t => t.length).filter(Boolean)

    // Species count
    const speciesSet = new Set(taxa.map(t => t.organism).filter(Boolean))

    return {
      genera: topGenera,
      lengths,
      totalTaxa: taxa.length,
      uniqueSpecies: speciesSet.size,
      uniqueGenera: Object.keys(genusCounts).length,
      avgLength: lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
      minLength: lengths.length > 0 ? Math.min(...lengths) : 0,
      maxLength: lengths.length > 0 ? Math.max(...lengths) : 0,
    }
  }, [taxonMeta])

  return (
    <div className="mt-6 space-y-4">

      {/* ── Stats Cards ── */}
      {charts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<TreePine size={20} className="text-emerald-500" />}
            label="Total Taxa" value={charts.totalTaxa} color="emerald" />
          <StatCard icon={<Layers size={20} className="text-blue-500" />}
            label="Unique Genera" value={charts.uniqueGenera} color="blue" />
          <StatCard icon={<Dna size={20} className="text-purple-500" />}
            label="Avg Length" value={`${charts.avgLength} aa`} color="purple" />
          <StatCard icon={<BarChart3 size={20} className="text-amber-500" />}
            label="Length Range" value={`${charts.minLength}–${charts.maxLength}`} color="amber" />
        </div>
      )}

      {/* ── Charts Row ── */}
      {charts && charts.genera.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Genus Distribution */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
              <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Layers size={14} className="text-blue-500" /> Taxonomic Distribution
              </h4>
            </div>
            <div className="p-2">
              <Plot
                data={[{
                  y: charts.genera.map(g => g[0]).reverse(),
                  x: charts.genera.map(g => g[1]).reverse(),
                  type: 'bar',
                  orientation: 'h',
                  marker: {
                    color: charts.genera.map((_, i) => {
                      const colors = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1','#14b8a6','#84cc16']
                      return colors[charts.genera.length - 1 - i] || colors[i % colors.length]
                    }).reverse(),
                    borderRadius: 4,
                  },
                  hovertemplate: '<b>%{y}</b><br>%{x} taxa<extra></extra>',
                }]}
                layout={{
                  height: 280,
                  margin: { t: 8, b: 30, l: 110, r: 20 },
                  xaxis: { title: { text: 'Count', font: { size: 11 } }, tickfont: { size: 10 } },
                  yaxis: { tickfont: { size: 11 }, automargin: true },
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  bargap: 0.3,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Protein Length Distribution */}
          {charts.lengths.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Dna size={14} className="text-purple-500" /> Sequence Length Distribution
                </h4>
              </div>
              <div className="p-2">
                <Plot
                  data={[{
                    x: charts.lengths,
                    type: 'histogram',
                    marker: {
                      color: 'rgba(139, 92, 246, 0.7)',
                      line: { color: 'rgba(139, 92, 246, 1)', width: 1 },
                    },
                    hovertemplate: '%{x} aa<br>%{y} sequences<extra></extra>',
                  }]}
                  layout={{
                    height: 280,
                    margin: { t: 8, b: 40, l: 50, r: 20 },
                    xaxis: { title: { text: 'Amino acids', font: { size: 11 } }, tickfont: { size: 10 } },
                    yaxis: { title: { text: 'Count', font: { size: 11 } }, tickfont: { size: 10 } },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    bargap: 0.05,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AI Tree Analysis Section ── */}
      <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 rounded-2xl border border-amber-200/60 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="px-6 py-4 border-b border-amber-200/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-xl">
              <Brain size={20} className="text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800">AI Tree Analysis</h3>
              <p className="text-xs text-gray-500 mt-0.5">Deep phylogenetic analysis powered by DeepSeek AI</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {treeInsights.length > 1 && (
              <button onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-amber-100/50 transition-colors">
                <Clock size={12} />
                {showHistory ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                {treeInsights.length} analyses
              </button>
            )}
          </div>
        </div>

        {/* Input area */}
        <div className="px-6 py-4 bg-white/40 border-b border-amber-200/30">
          <div className="flex gap-3">
            <div className="flex-1">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !loading) { e.preventDefault(); handleAi() }}}
                placeholder="Ask about evolutionary relationships, divergence patterns, or just click analyze..."
                rows={2}
                disabled={loading}
                className="w-full px-4 py-3 text-sm border border-amber-200 rounded-xl resize-none bg-white
                  focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300
                  disabled:opacity-50 disabled:cursor-wait placeholder-gray-400"
              />
            </div>
            <button onClick={handleAi} disabled={loading}
              className={`self-end px-5 py-3 rounded-xl font-medium text-sm transition-all flex items-center gap-2 ${
                loading
                  ? 'bg-gray-200 text-gray-400 cursor-wait'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-md hover:shadow-lg'
              }`}>
              {loading
                ? <><RefreshCw size={16} className="animate-spin" /> Analyzing...</>
                : <><Sparkles size={16} /> Analyze</>}
            </button>
          </div>
        </div>

        {/* Loading animation */}
        {loading && !latest && (
          <div className="px-6 py-12 text-center">
            <div className="inline-flex flex-col items-center gap-3">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                  <RefreshCw size={24} className="animate-spin text-amber-500" />
                </div>
                <Sparkles size={16} className="absolute -top-1 -right-1 text-amber-400 animate-pulse" />
              </div>
              <div>
                <p className="font-medium text-gray-700">AI is analyzing your phylogenetic tree...</p>
                <p className="text-xs text-gray-500 mt-1">Evaluating evolutionary patterns, divergence, and taxonomic composition</p>
              </div>
            </div>
          </div>
        )}

        {/* Latest AI response */}
        {latest && (
          <div className="px-6 py-5">
            <div className={`transition-all ${expandedAi ? '' : 'max-h-48 overflow-hidden relative'}`}>
              <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                <SimpleMarkdown text={latest.ai_response} />
              </div>
              {!expandedAi && (
                <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-amber-50 to-transparent" />
              )}
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <Brain size={12} />
                <span>{latest.model_used}</span>
                <span>·</span>
                <Clock size={10} />
                <span>{new Date(latest.created_at).toLocaleString()}</span>
                {latest.user_prompt && (
                  <span className="italic ml-2">&ldquo;{latest.user_prompt}&rdquo;</span>
                )}
              </div>
              <button onClick={() => setExpandedAi(!expandedAi)}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium">
                {expandedAi ? 'Collapse' : 'Expand full analysis'}
              </button>
            </div>
          </div>
        )}

        {/* No analysis yet */}
        {!latest && !loading && (
          <div className="px-6 py-10 text-center">
            <div className="inline-block p-4 rounded-full bg-amber-100/50 mb-4">
              <Sparkles size={36} className="text-amber-400" />
            </div>
            <p className="font-medium text-gray-700">No tree analysis yet</p>
            <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
              Click "Analyze" to get AI-powered insights about evolutionary relationships, divergence patterns, and taxonomic composition
            </p>
          </div>
        )}

        {/* History */}
        {showHistory && treeInsights.length > 1 && (
          <div className="px-6 pb-5 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Previous Analyses</p>
            {treeInsights.slice(1).map(ins => (
              <details key={ins.id} className="bg-white/70 border border-amber-200/50 rounded-xl overflow-hidden">
                <summary className="px-4 py-2.5 text-xs text-gray-500 cursor-pointer hover:bg-amber-50 flex items-center gap-2">
                  <Clock size={10} />
                  {new Date(ins.created_at).toLocaleString()}
                  {ins.user_prompt && <span className="italic ml-1">— &ldquo;{ins.user_prompt}&rdquo;</span>}
                </summary>
                <div className="px-4 py-3 border-t border-amber-200/50">
                  <SimpleMarkdown text={ins.ai_response} />
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  const bgMap = { emerald: 'bg-emerald-50 border-emerald-200', blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200', amber: 'bg-amber-50 border-amber-200' }
  return (
    <div className={`rounded-xl border p-4 ${bgMap[color] || 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</p>
          <p className="text-lg font-bold text-gray-800 mt-0.5">{value}</p>
        </div>
      </div>
    </div>
  )
}
