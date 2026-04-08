import { useState, useMemo } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Brain, Clock, TreePine, BarChart3, Dna, Layers, FileText, Zap, PieChart, TrendingUp } from 'lucide-react'
import Plot from 'react-plotly.js'
import DOIReferences, { DOIBadge } from './DOIReferences'
import InlineAIInsight from './InlineAIInsight'
import MarkdownRenderer from './MarkdownRenderer'

export default function TreeInsightPanel({ insights, onTreeAi, onAdvancedReport, loading, reportLoading, advancedReport, taxonMeta, features, experimentId }) {
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [expandedAi, setExpandedAi] = useState(true)
  const [expandedReport, setExpandedReport] = useState(true)
  const [activeSection, setActiveSection] = useState('charts') // 'charts' | 'ai' | 'report'

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

    // Taxonomy pie data
    const top5 = sortedGenera.slice(0, 5)
    const otherCount = sortedGenera.slice(5).reduce((sum, [, c]) => sum + c, 0)
    const pieLabels = top5.map(g => g[0])
    const pieValues = top5.map(g => g[1])
    if (otherCount > 0) { pieLabels.push('Other'); pieValues.push(otherCount) }

    return {
      genera: topGenera,
      lengths,
      totalTaxa: taxa.length,
      uniqueSpecies: speciesSet.size,
      uniqueGenera: Object.keys(genusCounts).length,
      avgLength: lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
      minLength: lengths.length > 0 ? Math.min(...lengths) : 0,
      maxLength: lengths.length > 0 ? Math.max(...lengths) : 0,
      stdLength: lengths.length > 1 ? Math.round(Math.sqrt(lengths.reduce((s, l) => {
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
        return s + (l - mean) ** 2
      }, 0) / (lengths.length - 1))) : 0,
      pieLabels,
      pieValues,
    }
  }, [taxonMeta])

  // Feature-derived data
  const featureCharts = useMemo(() => {
    if (!features || features.length === 0) return null
    const hydro = features.map(f => f.hydrophobic_frac).filter(v => v != null)
    const charged = features.map(f => f.charged_frac).filter(v => v != null)
    const mw = features.map(f => f.molecular_weight).filter(v => v != null)
    return { hydro, charged, mw }
  }, [features])

  const sections = [
    { id: 'charts', label: 'Statistics', icon: <BarChart3 size={14} /> },
    { id: 'ai', label: 'AI Analysis', icon: <Brain size={14} /> },
    { id: 'report', label: 'Full Report', icon: <FileText size={14} /> },
  ]

  return (
    <div className="mt-6 space-y-4">

      {/* ── Stats Cards ── */}
      {charts && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard icon={<TreePine size={18} className="text-emerald-500" />}
            label="Total Taxa" value={charts.totalTaxa} color="emerald" />
          <StatCard icon={<Layers size={18} className="text-blue-500" />}
            label="Unique Genera" value={charts.uniqueGenera} color="blue" />
          <StatCard icon={<PieChart size={18} className="text-cyan-500" />}
            label="Species" value={charts.uniqueSpecies} color="cyan" />
          <StatCard icon={<Dna size={18} className="text-purple-500" />}
            label="Avg Length" value={`${charts.avgLength} aa`} color="purple" />
          <StatCard icon={<TrendingUp size={18} className="text-rose-500" />}
            label="Std Dev" value={`±${charts.stdLength}`} color="rose" />
          <StatCard icon={<BarChart3 size={18} className="text-amber-500" />}
            label="Range" value={`${charts.minLength}–${charts.maxLength}`} color="amber" />
        </div>
      )}

      {/* ── Section Tabs ── */}
      <div className="flex border-b border-gray-200 bg-white rounded-t-xl">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              activeSection === s.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {s.icon} {s.label}
            {s.id === 'report' && advancedReport?.doi_references?.length > 0 && (
              <DOIBadge references={advancedReport.doi_references} />
            )}
          </button>
        ))}
      </div>

      {/* ── Charts Section ── */}
      {activeSection === 'charts' && charts && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Genus Distribution */}
            {charts.genera.length > 0 && (
              <ChartCard title="Taxonomic Distribution" icon={<Layers size={14} className="text-blue-500" />}>
                <Plot
                  data={[{
                    y: charts.genera.map(g => g[0]).reverse(),
                    x: charts.genera.map(g => g[1]).reverse(),
                    type: 'bar', orientation: 'h',
                    marker: {
                      color: charts.genera.map((_, i) => {
                        const c = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1','#14b8a6','#84cc16']
                        return c[charts.genera.length - 1 - i] || c[i % c.length]
                      }).reverse(),
                    },
                    hovertemplate: '<b>%{y}</b><br>%{x} taxa<extra></extra>',
                  }]}
                  layout={{ height: 280, margin: { t: 8, b: 30, l: 110, r: 20 },
                    xaxis: { title: { text: 'Count', font: { size: 11 } } },
                    yaxis: { tickfont: { size: 11 }, automargin: true },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', bargap: 0.3 }}
                  config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }}
                />
              </ChartCard>
            )}

            {/* Taxonomy Pie */}
            <ChartCard title="Genus Composition" icon={<PieChart size={14} className="text-cyan-500" />}>
              <Plot
                data={[{
                  labels: charts.pieLabels, values: charts.pieValues,
                  type: 'pie', hole: 0.4,
                  marker: { colors: ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#9ca3af'] },
                  textinfo: 'label+percent', textfont: { size: 11 },
                  hovertemplate: '<b>%{label}</b><br>%{value} taxa (%{percent})<extra></extra>',
                }]}
                layout={{ height: 280, margin: { t: 10, b: 10, l: 10, r: 10 },
                  paper_bgcolor: 'transparent', showlegend: false }}
                config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }}
              />
            </ChartCard>
          </div>

          {/* AI insight after taxonomy charts */}
          {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_taxonomy" />}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sequence Length Histogram */}
            {charts.lengths.length > 0 && (
              <ChartCard title="Sequence Length Distribution" icon={<Dna size={14} className="text-purple-500" />}>
                <Plot
                  data={[{
                    x: charts.lengths, type: 'histogram',
                    marker: { color: 'rgba(139,92,246,0.7)', line: { color: 'rgba(139,92,246,1)', width: 1 } },
                    hovertemplate: '%{x} aa<br>%{y} seqs<extra></extra>',
                  }]}
                  layout={{ height: 280, margin: { t: 8, b: 40, l: 50, r: 20 },
                    xaxis: { title: { text: 'Amino acids', font: { size: 11 } } },
                    yaxis: { title: { text: 'Count', font: { size: 11 } } },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', bargap: 0.05 }}
                  config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }}
                />
              </ChartCard>
            )}

            {/* Sequence Length Box Plot */}
            {charts.lengths.length > 0 && (
              <ChartCard title="Length Distribution Box Plot" icon={<TrendingUp size={14} className="text-rose-500" />}>
                <Plot
                  data={[{
                    y: charts.lengths, type: 'box', name: 'Sequence Length',
                    marker: { color: '#e11d48' }, boxpoints: 'outliers',
                  }]}
                  layout={{ height: 280, margin: { t: 10, b: 30, l: 50, r: 20 },
                    yaxis: { title: { text: 'Amino acids', font: { size: 11 } } },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent' }}
                  config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }}
                />
              </ChartCard>
            )}
          </div>

          {/* AI insight after length charts */}
          {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_lengths" />}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Hydrophobicity Distribution */}
            {featureCharts?.hydro?.length > 0 && (
              <ChartCard title="Hydrophobic Fraction" icon={<Zap size={14} className="text-blue-500" />}>
                <Plot
                  data={[{
                    x: featureCharts.hydro, type: 'histogram', nbinsx: 20,
                    marker: { color: 'rgba(37,99,235,0.6)', line: { color: '#2563eb', width: 1 } },
                    hovertemplate: '%{x:.3f}<br>%{y} seqs<extra></extra>',
                  }]}
                  layout={{ height: 250, margin: { t: 8, b: 40, l: 50, r: 20 },
                    xaxis: { title: { text: 'Fraction', font: { size: 11 } } },
                    yaxis: { title: { text: 'Count', font: { size: 11 } } },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent' }}
                  config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }}
                />
              </ChartCard>
            )}

            {/* Charged Fraction Distribution */}
            {featureCharts?.charged?.length > 0 && (
              <ChartCard title="Charged Fraction" icon={<Zap size={14} className="text-red-500" />}>
                <Plot
                  data={[{
                    x: featureCharts.charged, type: 'histogram', nbinsx: 20,
                    marker: { color: 'rgba(220,38,38,0.6)', line: { color: '#dc2626', width: 1 } },
                    hovertemplate: '%{x:.3f}<br>%{y} seqs<extra></extra>',
                  }]}
                  layout={{ height: 250, margin: { t: 8, b: 40, l: 50, r: 20 },
                    xaxis: { title: { text: 'Fraction', font: { size: 11 } } },
                    yaxis: { title: { text: 'Count', font: { size: 11 } } },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent' }}
                  config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }}
                />
              </ChartCard>
            )}
          </div>

          {/* AI insight after feature charts + overall tree summary */}
          {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_features" />}
          {experimentId && <InlineAIInsight experimentId={experimentId} scope="tree_auto" />}
        </div>
      )}

      {/* ── AI Tree Analysis Section ── */}
      {activeSection === 'ai' && (
        <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 rounded-2xl border border-amber-200/60 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-amber-200/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-xl"><Brain size={20} className="text-amber-600" /></div>
              <div>
                <h3 className="font-bold text-gray-800">AI Tree Analysis</h3>
                <p className="text-xs text-gray-500 mt-0.5">Deep phylogenetic analysis powered by DeepSeek AI</p>
              </div>
            </div>
            {treeInsights.length > 1 && (
              <button onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-amber-100/50">
                <Clock size={12} />
                {showHistory ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                {treeInsights.length} analyses
              </button>
            )}
          </div>

          <div className="px-6 py-4 bg-white/40 border-b border-amber-200/30">
            <div className="flex gap-3">
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !loading) { e.preventDefault(); handleAi() }}}
                placeholder="Ask about evolutionary relationships..." rows={2} disabled={loading}
                className="flex-1 px-4 py-3 text-sm border border-amber-200 rounded-xl resize-none bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-50" />
              <button onClick={handleAi} disabled={loading}
                className={`self-end px-5 py-3 rounded-xl font-medium text-sm flex items-center gap-2 ${
                  loading ? 'bg-gray-200 text-gray-400' : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-md'}`}>
                {loading ? <><RefreshCw size={16} className="animate-spin" /> Analyzing...</> : <><Sparkles size={16} /> Analyze</>}
              </button>
            </div>
          </div>

          {loading && !latest && (
            <div className="px-6 py-12 text-center">
              <div className="inline-flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center relative">
                  <RefreshCw size={24} className="animate-spin text-amber-500" />
                  <Sparkles size={16} className="absolute -top-1 -right-1 text-amber-400 animate-pulse" />
                </div>
                <p className="font-medium text-gray-700">AI analyzing tree...</p>
              </div>
            </div>
          )}

          {latest && (
            <div className="px-6 py-5">
              <div className={`transition-all ${expandedAi ? '' : 'max-h-48 overflow-hidden relative'}`}>
                <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                  <MarkdownRenderer text={latest.ai_response} />
                  {latest.doi_references?.length > 0 && (
                    <DOIReferences references={latest.doi_references} />
                  )}
                </div>
                {!expandedAi && <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-amber-50 to-transparent" />}
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <Brain size={12} /> <span>{latest.model_used}</span>
                  <span>·</span> <Clock size={10} />
                  <span>{new Date(latest.created_at).toLocaleString()}</span>
                  {latest.doi_references?.length > 0 && <DOIBadge references={latest.doi_references} />}
                </div>
                <button onClick={() => setExpandedAi(!expandedAi)}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium">
                  {expandedAi ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>
          )}

          {!latest && !loading && (
            <div className="px-6 py-10 text-center">
              <Sparkles size={36} className="mx-auto text-amber-400 mb-3" />
              <p className="font-medium text-gray-700">No tree analysis yet</p>
              <p className="text-sm text-gray-400 mt-1">Click "Analyze" for AI-powered insights</p>
            </div>
          )}

          {showHistory && treeInsights.length > 1 && (
            <div className="px-6 pb-5 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Previous Analyses</p>
              {treeInsights.slice(1).map(ins => (
                <details key={ins.id} className="bg-white/70 border border-amber-200/50 rounded-xl overflow-hidden">
                  <summary className="px-4 py-2.5 text-xs text-gray-500 cursor-pointer hover:bg-amber-50 flex items-center gap-2">
                    <Clock size={10} /> {new Date(ins.created_at).toLocaleString()}
                    {ins.doi_references?.length > 0 && <DOIBadge references={ins.doi_references} />}
                  </summary>
                  <div className="px-4 py-3 border-t border-amber-200/50">
                    <MarkdownRenderer text={ins.ai_response} />
                    {ins.doi_references?.length > 0 && <DOIReferences references={ins.doi_references} />}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Advanced Report Section ── */}
      {activeSection === 'report' && (
        <div className="bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50 rounded-2xl border border-indigo-200/60 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-indigo-200/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-xl"><FileText size={20} className="text-indigo-600" /></div>
              <div>
                <h3 className="font-bold text-gray-800">Advanced Scientific Report</h3>
                <p className="text-xs text-gray-500 mt-0.5">Comprehensive AI analysis with validated DOI references</p>
              </div>
            </div>
            {!advancedReport && !reportLoading && (
              <button onClick={() => onAdvancedReport()}
                className="px-5 py-2.5 rounded-xl font-medium text-sm bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-md flex items-center gap-2">
                <Zap size={16} /> Generate Report
              </button>
            )}
          </div>

          {reportLoading && (
            <div className="px-6 py-16 text-center">
              <div className="inline-flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center relative">
                  <RefreshCw size={28} className="animate-spin text-indigo-500" />
                  <FileText size={14} className="absolute -bottom-1 -right-1 text-indigo-400 animate-pulse" />
                </div>
                <div>
                  <p className="font-semibold text-gray-700">Generating comprehensive report...</p>
                  <p className="text-xs text-gray-500 mt-1">AI agent is analyzing data, searching DOIs and validating references via CrossRef</p>
                </div>
                <div className="flex gap-2 mt-2">
                  {['Analyzing tree', 'Extracting features', 'Searching DOIs', 'Validating references'].map((step, i) => (
                    <span key={i} className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-1 rounded-full animate-pulse"
                      style={{ animationDelay: `${i * 0.5}s` }}>{step}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {advancedReport && (
            <div className="px-6 py-5">
              <div className={`transition-all ${expandedReport ? '' : 'max-h-64 overflow-hidden relative'}`}>
                <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                  <MarkdownRenderer text={advancedReport.ai_response} />
                  <DOIReferences references={advancedReport.doi_references} />
                </div>
                {!expandedReport && <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-indigo-50 to-transparent" />}
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <Brain size={12} /> <span>{advancedReport.model_used}</span>
                  <span>·</span> <Clock size={10} />
                  <span>{new Date(advancedReport.created_at).toLocaleString()}</span>
                  <DOIBadge references={advancedReport.doi_references} />
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => onAdvancedReport()} disabled={reportLoading}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
                    <RefreshCw size={10} /> Regenerate
                  </button>
                  <button onClick={() => setExpandedReport(!expandedReport)}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                    {expandedReport ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!advancedReport && !reportLoading && (
            <div className="px-6 py-12 text-center">
              <FileText size={40} className="mx-auto text-indigo-300 mb-3" />
              <p className="font-medium text-gray-700">No report generated yet</p>
              <p className="text-sm text-gray-400 mt-1 max-w-lg mx-auto">
                Generate a comprehensive scientific report with validated DOI references covering taxonomy, evolution, function, and biotechnology applications
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">{icon} {title}</h4>
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  const bgMap = {
    emerald: 'bg-emerald-50 border-emerald-200', blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200', amber: 'bg-amber-50 border-amber-200',
    cyan: 'bg-cyan-50 border-cyan-200', rose: 'bg-rose-50 border-rose-200',
  }
  return (
    <div className={`rounded-xl border p-3 ${bgMap[color] || 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</p>
          <p className="text-base font-bold text-gray-800 mt-0.5">{value}</p>
        </div>
      </div>
    </div>
  )
}
