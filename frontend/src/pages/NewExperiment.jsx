import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { experiments, ncbi, ai } from '../api'
import { Search, Sparkles, SlidersHorizontal, Rocket, ChevronRight, ChevronLeft, Check, Loader2, Brain, Filter } from 'lucide-react'

const STEPS = [
  { id: 'search', label: 'Search NCBI', icon: Search },
  { id: 'select', label: 'Select Sequences', icon: Filter },
  { id: 'params', label: 'Alignment Params', icon: SlidersHorizontal },
  { id: 'launch', label: 'Review & Launch', icon: Rocket },
]

const WEIGHT_MATRICES = ['BLOSUM62', 'Gonnet', 'PAM250', 'BLOSUM45', 'BLOSUM80']
const ALIGN_METHODS = [
  { value: 'mafft', label: 'MAFFT (Recommended)' },
  { value: 'muscle', label: 'MUSCLE' },
]

export default function NewExperiment() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  // Step 1: Search
  const [form, setForm] = useState({
    name: '',
    description: '',
    query: '',
    organism: '',
    max_results: 200,
  })
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState(null)

  // Step 2: Selection
  const [selected, setSelected] = useState(new Set())
  const [aiLoading, setAiLoading] = useState(false)
  const [aiReasoning, setAiReasoning] = useState('')
  const [filterText, setFilterText] = useState('')

  // Step 3: Alignment params
  const [alignParams, setAlignParams] = useState({
    method: 'mafft',
    gap_opening_penalty: 1.53,
    gap_extension_penalty: 0.123,
    protein_weight_matrix: 'BLOSUM62',
    max_iterations: 16,
  })
  const [paramsAiLoading, setParamsAiLoading] = useState(false)
  const [paramsReasoning, setParamsReasoning] = useState('')

  // Step 4: Launch
  const [submitting, setSubmitting] = useState(false)

  // ===== Step 1: Search NCBI =====
  const handleSearch = async (e) => {
    e.preventDefault()
    if (!form.query.trim()) return
    setSearching(true)
    try {
      const res = await ncbi.search({
        query: form.query,
        organism: form.organism || undefined,
        max_results: form.max_results,
      })
      setSearchResults(res.data)
      setSelected(new Set())
      setAiReasoning('')
      setStep(1)
    } catch (err) {
      alert(`Search failed: ${err.response?.data?.detail || err.message}`)
    } finally {
      setSearching(false)
    }
  }

  // ===== Step 2: AI Recommend =====
  const handleAIRecommend = async () => {
    if (!searchResults?.sequences?.length) return
    setAiLoading(true)
    try {
      const res = await ai.recommendSequences({
        sequences: searchResults.sequences,
        experiment_name: form.name || form.query,
        experiment_description: form.description,
        query: form.query,
        organism: form.organism || undefined,
      })
      const recommended = new Set(res.data.recommended_accessions)
      setSelected(recommended)
      setAiReasoning(res.data.reasoning)
    } catch (err) {
      alert(`AI recommendation failed: ${err.response?.data?.detail || err.message}`)
    } finally {
      setAiLoading(false)
    }
  }

  const toggleSequence = (acc) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(acc)) next.delete(acc)
      else next.add(acc)
      return next
    })
  }

  const selectAll = () => {
    if (!searchResults?.sequences) return
    setSelected(new Set(searchResults.sequences.map((s) => s.accession)))
  }

  const selectNone = () => setSelected(new Set())

  const filteredSequences = useMemo(() => {
    if (!searchResults?.sequences) return []
    if (!filterText.trim()) return searchResults.sequences
    const lower = filterText.toLowerCase()
    return searchResults.sequences.filter(
      (s) =>
        s.accession.toLowerCase().includes(lower) ||
        s.title.toLowerCase().includes(lower) ||
        s.organism.toLowerCase().includes(lower)
    )
  }, [searchResults, filterText])

  // ===== Step 3: AI Alignment Params =====
  const handleAIParams = async () => {
    setParamsAiLoading(true)
    try {
      const selectedSeqs = searchResults?.sequences?.filter((s) => selected.has(s.accession)) || []
      const avgLen = selectedSeqs.length > 0
        ? selectedSeqs.reduce((acc, s) => acc + s.length, 0) / selectedSeqs.length
        : undefined
      const res = await ai.recommendAlignmentParams({
        experiment_name: form.name || form.query,
        experiment_description: form.description,
        query: form.query,
        organism: form.organism || undefined,
        num_sequences: selected.size,
        avg_length: avgLen,
      })
      setAlignParams(res.data.params)
      setParamsReasoning(res.data.reasoning)
    } catch (err) {
      alert(`AI params failed: ${err.response?.data?.detail || err.message}`)
    } finally {
      setParamsAiLoading(false)
    }
  }

  // ===== Step 4: Launch =====
  const handleLaunch = async () => {
    setSubmitting(true)
    try {
      const res = await experiments.create({
        name: form.name || form.query,
        description: form.description,
        query: form.query,
        organism: form.organism || undefined,
        max_sequences: selected.size || form.max_results,
        selected_sequences: selected.size > 0 ? [...selected] : undefined,
        alignment_params: alignParams,
      })
      // Auto-run pipeline
      await experiments.run(res.data.id)
      navigate(`/experiment/${res.data.id}`)
    } catch (err) {
      alert(`Launch failed: ${err.response?.data?.detail || err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Stepper */}
      <div className="flex items-center mb-8 bg-white rounded-xl p-4 shadow-sm border">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const active = i === step
          const done = i < step
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm font-medium ${
                  active
                    ? 'bg-sky-100 text-sky-700'
                    : done
                    ? 'bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer'
                    : 'text-gray-300 cursor-not-allowed'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  active ? 'bg-sky-500 text-white' : done ? 'bg-green-500 text-white' : 'bg-gray-200'
                }`}>
                  {done ? <Check size={14} /> : <Icon size={14} />}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <ChevronRight size={16} className="mx-2 text-gray-300 shrink-0" />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1: Search NCBI */}
      {step === 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Search NCBI Database</h2>
          <p className="text-sm text-gray-500 mb-6">Find protein sequences to analyze. Like searching in MEGA but with AI-powered recommendations.</p>

          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Experiment Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., GH13 Alpha-amylase Phylogeny"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What are you investigating?"
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">NCBI Search Query *</label>
                <input
                  value={form.query}
                  onChange={(e) => setForm({ ...form, query: e.target.value })}
                  required
                  placeholder="e.g., GH13 alpha-amylase"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Organism Filter</label>
                <input
                  value={form.organism}
                  onChange={(e) => setForm({ ...form, organism: e.target.value })}
                  placeholder="e.g., Homo sapiens"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Results</label>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={form.max_results}
                  onChange={(e) => setForm({ ...form, max_results: parseInt(e.target.value) || 200 })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={searching || !form.query.trim()}
              className="w-full bg-gradient-to-r from-sky-500 to-blue-600 text-white py-3 rounded-lg font-medium hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {searching ? <><Loader2 size={18} className="animate-spin" /> Searching NCBI...</> : <><Search size={18} /> Search Sequences</>}
            </button>
          </form>
        </div>
      )}

      {/* Step 2: Select Sequences */}
      {step === 1 && searchResults && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-6 border-b">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Select Sequences
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({searchResults.total_found} found, {searchResults.sequences.length} loaded)
                  </span>
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Selected: <span className="font-semibold text-sky-600">{selected.size}</span> sequences
                </p>
              </div>
              <button
                onClick={handleAIRecommend}
                disabled={aiLoading}
                className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-sm"
              >
                {aiLoading ? <><Loader2 size={16} className="animate-spin" /> Analyzing...</> : <><Brain size={16} /> AI Recommend</>}
              </button>
            </div>

            {aiReasoning && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-purple-800 flex items-start gap-2">
                  <Sparkles size={16} className="shrink-0 mt-0.5 text-purple-500" />
                  <span><strong>AI Reasoning:</strong> {aiReasoning}</span>
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by accession, title, or organism..."
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"
              />
              <button onClick={selectAll} className="text-sm text-sky-600 hover:text-sky-800 font-medium whitespace-nowrap">Select All</button>
              <button onClick={selectNone} className="text-sm text-gray-500 hover:text-gray-700 font-medium whitespace-nowrap">Clear</button>
            </div>
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === searchResults.sequences.length && selected.size > 0}
                      onChange={() => selected.size === searchResults.sequences.length ? selectNone() : selectAll()}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left p-3 font-medium text-gray-600">Accession</th>
                  <th className="text-left p-3 font-medium text-gray-600">Description</th>
                  <th className="text-left p-3 font-medium text-gray-600">Organism</th>
                  <th className="text-right p-3 font-medium text-gray-600">Length</th>
                </tr>
              </thead>
              <tbody>
                {filteredSequences.map((seq) => {
                  const isSelected = selected.has(seq.accession)
                  return (
                    <tr
                      key={seq.uid}
                      onClick={() => toggleSequence(seq.accession)}
                      className={`border-t cursor-pointer transition-colors ${
                        isSelected ? 'bg-sky-50 hover:bg-sky-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSequence(seq.accession)}
                          className="rounded"
                        />
                      </td>
                      <td className="p-3 font-mono text-xs text-sky-700 font-medium">{seq.accession}</td>
                      <td className="p-3 text-gray-700 max-w-xs truncate" title={seq.title}>{seq.title}</td>
                      <td className="p-3 text-gray-500 italic text-xs">{seq.organism}</td>
                      <td className="p-3 text-right text-gray-600">{seq.length} aa</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredSequences.length === 0 && (
              <p className="text-center text-gray-400 py-8">No sequences match the filter</p>
            )}
          </div>

          <div className="p-4 border-t flex justify-between">
            <button onClick={() => setStep(0)} className="flex items-center gap-1 text-gray-600 hover:text-gray-800">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={() => { if (selected.size > 0) setStep(2) }}
              disabled={selected.size === 0}
              className="bg-sky-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1"
            >
              Continue with {selected.size} sequences <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Alignment Parameters */}
      {step === 2 && (
        <div className="bg-white rounded-xl shadow-sm border p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Alignment Parameters</h2>
              <p className="text-sm text-gray-500 mt-1">Configure multiple sequence alignment settings (like MEGA)</p>
            </div>
            <button
              onClick={handleAIParams}
              disabled={paramsAiLoading}
              className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-sm"
            >
              {paramsAiLoading ? <><Loader2 size={16} className="animate-spin" /> Analyzing...</> : <><Brain size={16} /> AI Suggest</>}
            </button>
          </div>

          {paramsReasoning && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-purple-800 flex items-start gap-2">
                <Sparkles size={16} className="shrink-0 mt-0.5 text-purple-500" />
                <span><strong>AI Reasoning:</strong> {paramsReasoning}</span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alignment Method</label>
              <select
                value={alignParams.method}
                onChange={(e) => setAlignParams({ ...alignParams, method: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500"
              >
                {ALIGN_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Protein Weight Matrix</label>
              <select
                value={alignParams.protein_weight_matrix}
                onChange={(e) => setAlignParams({ ...alignParams, protein_weight_matrix: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500"
              >
                {WEIGHT_MATRICES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gap Opening Penalty</label>
              <input
                type="number"
                step={0.01}
                min={0}
                value={alignParams.gap_opening_penalty}
                onChange={(e) => setAlignParams({ ...alignParams, gap_opening_penalty: parseFloat(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-xs text-gray-400 mt-1">Higher = fewer gaps (MAFFT default: 1.53, MEGA default: 10.00)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gap Extension Penalty</label>
              <input
                type="number"
                step={0.001}
                min={0}
                value={alignParams.gap_extension_penalty}
                onChange={(e) => setAlignParams({ ...alignParams, gap_extension_penalty: parseFloat(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-xs text-gray-400 mt-1">Lower = allow longer gaps (MAFFT default: 0.123, MEGA default: 0.20)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Iterations</label>
              <input
                type="number"
                min={1}
                max={100}
                value={alignParams.max_iterations}
                onChange={(e) => setAlignParams({ ...alignParams, max_iterations: parseInt(e.target.value) || 16 })}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="flex justify-between mt-8">
            <button onClick={() => setStep(1)} className="flex items-center gap-1 text-gray-600 hover:text-gray-800">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="bg-sky-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-sky-700 flex items-center gap-1"
            >
              Review & Launch <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Launch */}
      {step === 3 && (
        <div className="bg-white rounded-xl shadow-sm border p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Review & Launch Pipeline</h2>

          <div className="space-y-4">
            <ReviewSection title="Experiment">
              <ReviewItem label="Name" value={form.name || form.query} />
              {form.description && <ReviewItem label="Description" value={form.description} />}
              <ReviewItem label="NCBI Query" value={form.query} />
              {form.organism && <ReviewItem label="Organism" value={form.organism} />}
            </ReviewSection>

            <ReviewSection title="Sequences">
              <ReviewItem label="Selected" value={`${selected.size} sequences`} />
              <div className="max-h-32 overflow-y-auto mt-2 bg-gray-50 rounded-lg p-2">
                <div className="flex flex-wrap gap-1">
                  {[...selected].slice(0, 50).map((acc) => (
                    <span key={acc} className="bg-sky-100 text-sky-700 text-xs px-2 py-0.5 rounded font-mono">{acc}</span>
                  ))}
                  {selected.size > 50 && (
                    <span className="text-gray-400 text-xs px-2 py-0.5">+{selected.size - 50} more</span>
                  )}
                </div>
              </div>
            </ReviewSection>

            <ReviewSection title="Alignment Parameters">
              <ReviewItem label="Method" value={alignParams.method.toUpperCase()} />
              <ReviewItem label="Gap Opening Penalty" value={alignParams.gap_opening_penalty} />
              <ReviewItem label="Gap Extension Penalty" value={alignParams.gap_extension_penalty} />
              <ReviewItem label="Weight Matrix" value={alignParams.protein_weight_matrix} />
              <ReviewItem label="Max Iterations" value={alignParams.max_iterations} />
            </ReviewSection>
          </div>

          <div className="flex justify-between mt-8">
            <button onClick={() => setStep(2)} className="flex items-center gap-1 text-gray-600 hover:text-gray-800">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={handleLaunch}
              disabled={submitting}
              className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-8 py-3 rounded-lg font-medium hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-md text-lg"
            >
              {submitting ? <><Loader2 size={20} className="animate-spin" /> Launching...</> : <><Rocket size={20} /> Launch Pipeline</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewSection({ title, children }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function ReviewItem({ label, value }) {
  return (
    <div className="flex items-center text-sm">
      <span className="text-gray-500 w-40">{label}:</span>
      <span className="font-medium text-gray-800">{String(value)}</span>
    </div>
  )
}
