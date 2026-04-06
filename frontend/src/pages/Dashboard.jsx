import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { experiments } from '../api'

const STATUS_COLORS = {
  created: 'bg-gray-100 text-gray-800',
  downloading: 'bg-blue-100 text-blue-800',
  processing: 'bg-yellow-100 text-yellow-800',
  aligning: 'bg-purple-100 text-purple-800',
  building_tree: 'bg-indigo-100 text-indigo-800',
  complete: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export default function Dashboard() {
  const [data, setData] = useState({ experiments: [], total: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    experiments.list().then((res) => {
      setData(res.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phylo-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Experiments</h1>
          <p className="text-gray-500 mt-1">{data.total} phylogenetic analyses</p>
        </div>
      </div>

      {data.experiments.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm">
          <span className="text-5xl mb-4 block">🧬</span>
          <h3 className="text-lg font-medium text-gray-900">No experiments yet</h3>
          <p className="text-gray-500 mt-2">Create your first phylogenetic analysis</p>
          <Link
            to="/new"
            className="mt-4 inline-block bg-phylo-600 text-white px-6 py-2 rounded-lg hover:bg-phylo-700"
          >
            Create Experiment
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {data.experiments.map((exp) => (
            <Link
              key={exp.id}
              to={`/experiment/${exp.id}`}
              className="bg-white p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow border"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{exp.name}</h3>
                  <p className="text-gray-500 text-sm mt-1">Query: {exp.query}</p>
                  {exp.organism && (
                    <p className="text-gray-400 text-sm">Organism: {exp.organism}</p>
                  )}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[exp.status] || ''}`}>
                  {exp.status}
                </span>
              </div>
              <div className="mt-3 flex items-center text-sm text-gray-400 space-x-4">
                <span>Max sequences: {exp.max_sequences}</span>
                <span>Created: {new Date(exp.created_at).toLocaleDateString()}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-500">
                  Preview codes: {exp.selected_sequences?.length || 0}
                </span>
                {exp.selected_sequences?.slice(0, 3).map((accession) => (
                  <span key={accession} className="bg-sky-50 text-sky-700 px-2 py-1 rounded font-mono text-xs border border-sky-100">
                    {accession}
                  </span>
                ))}
                {!exp.selected_sequences?.length && (
                  <span className="text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded text-xs">
                    no saved accession preview
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
