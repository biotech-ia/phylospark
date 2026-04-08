import { CheckCircle, XCircle, ExternalLink, BookOpen, AlertTriangle } from 'lucide-react'

export default function DOIReferences({ references }) {
  if (!references || references.length === 0) return null

  const validated = references.filter(r => r.validated)
  const unvalidated = references.filter(r => !r.validated)

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <BookOpen size={14} className="text-indigo-500" />
          DOI References
        </h4>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
            <CheckCircle size={10} /> {validated.length} verified
          </span>
          {unvalidated.length > 0 && (
            <span className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              <AlertTriangle size={10} /> {unvalidated.length} unverified
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {references.map((ref, idx) => (
          <DOICard key={`${ref.doi}-${idx}`} reference={ref} />
        ))}
      </div>
    </div>
  )
}

function DOICard({ reference }) {
  const { doi, title, authors, journal, year, validated, url } = reference
  const doiUrl = url || `https://doi.org/${doi}`

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      validated
        ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50'
        : 'border-amber-200 bg-amber-50/50 hover:bg-amber-50'
    }`}>
      <div className="flex items-start gap-2">
        {validated ? (
          <CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" />
        ) : (
          <XCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <p className="text-sm font-medium text-gray-800 leading-snug">{title}</p>
          )}
          {authors && (
            <p className="text-xs text-gray-500 mt-0.5">{authors}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {journal && (
              <span className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600 italic">
                {journal}
              </span>
            )}
            {year && (
              <span className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600">
                {year}
              </span>
            )}
            <a
              href={doiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              {doi} <ExternalLink size={9} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DOIBadge({ references }) {
  if (!references || references.length === 0) return null
  const validated = references.filter(r => r.validated).length
  const total = references.length

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
      validated === total
        ? 'bg-emerald-100 text-emerald-700'
        : validated > 0
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700'
    }`}>
      <BookOpen size={10} />
      {validated}/{total} DOIs
    </span>
  )
}
