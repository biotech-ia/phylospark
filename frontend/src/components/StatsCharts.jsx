import Plot from 'react-plotly.js'
import InlineAIInsight from './InlineAIInsight'

export default function StatsCharts({ features, distanceMatrix, experimentId }) {
  if (!features && !distanceMatrix) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
        No statistics available yet
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Sequence Length Distribution */}
      {features && features.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="font-semibold text-gray-800 mb-4">Sequence Length Distribution</h3>
          <Plot
            data={[{
              x: features.map(f => f.seq_id),
              y: features.map(f => f.length),
              type: 'bar',
              marker: { color: '#0ea5e9', opacity: 0.8 },
              hovertemplate: '%{x}<br>Length: %{y} aa<extra></extra>',
            }]}
            layout={{
              height: 300,
              margin: { t: 10, b: 80, l: 50, r: 20 },
              xaxis: { tickangle: -45, tickfont: { size: 9 } },
              yaxis: { title: 'Amino acids' },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_length_distribution" />}

      {/* Amino Acid Composition Heatmap */}
      {features && features.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="font-semibold text-gray-800 mb-4">Amino Acid Composition</h3>
          <Plot
            data={[{
              z: features.map(f =>
                'ACDEFGHIKLMNPQRSTVWY'.split('').map(aa => f[`aa_${aa}`] || 0)
              ),
              x: 'ACDEFGHIKLMNPQRSTVWY'.split(''),
              y: features.map(f => f.seq_id?.slice(0, 15) || ''),
              type: 'heatmap',
              colorscale: 'YlGnBu',
              hovertemplate: 'Seq: %{y}<br>AA: %{x}<br>Fraction: %{z:.3f}<extra></extra>',
            }]}
            layout={{
              height: Math.max(300, features.length * 28),
              margin: { t: 10, b: 50, l: 120, r: 20 },
              xaxis: { title: 'Amino Acid' },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_aa_composition" />}

      {/* Hydrophobic vs Charged Scatter */}
      {features && features.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="font-semibold text-gray-800 mb-4">Hydrophobic vs Charged Fraction</h3>
          <Plot
            data={[{
              x: features.map(f => f.hydrophobic_frac),
              y: features.map(f => f.charged_frac),
              text: features.map(f => f.seq_id),
              mode: 'markers+text',
              type: 'scatter',
              textposition: 'top center',
              textfont: { size: 8 },
              marker: {
                size: features.map(f => Math.sqrt(f.length) * 1.5),
                color: features.map(f => f.length),
                colorscale: 'Viridis',
                showscale: true,
                colorbar: { title: 'Length' },
              },
              hovertemplate: '%{text}<br>Hydrophobic: %{x:.3f}<br>Charged: %{y:.3f}<extra></extra>',
            }]}
            layout={{
              height: 400,
              margin: { t: 10, b: 50, l: 60, r: 20 },
              xaxis: { title: 'Hydrophobic fraction' },
              yaxis: { title: 'Charged fraction' },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_hydrophobic_charged" />}

      {/* Distance Heatmap */}
      {distanceMatrix && distanceMatrix.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="font-semibold text-gray-800 mb-4">Pairwise Distance Matrix</h3>
          <DistanceHeatmap distances={distanceMatrix} />
        </div>
      )}

      {experimentId && <InlineAIInsight experimentId={experimentId} scope="chart_distance_matrix" />}

      {/* Overall Stats AI Summary */}
      {experimentId && <InlineAIInsight experimentId={experimentId} scope="stats_auto" />}
    </div>
  )
}

function DistanceHeatmap({ distances }) {
  // Build symmetric matrix from pair list
  const seqSet = new Set()
  distances.forEach(d => { seqSet.add(d.seq_a); seqSet.add(d.seq_b) })
  const seqs = [...seqSet].sort()
  const n = seqs.length
  const idx = Object.fromEntries(seqs.map((s, i) => [s, i]))

  const matrix = Array.from({ length: n }, () => Array(n).fill(0))
  distances.forEach(d => {
    const i = idx[d.seq_a]
    const j = idx[d.seq_b]
    if (i !== undefined && j !== undefined) {
      matrix[i][j] = d.euclidean_distance
      matrix[j][i] = d.euclidean_distance
    }
  })

  return (
    <Plot
      data={[{
        z: matrix,
        x: seqs.map(s => s.slice(0, 12)),
        y: seqs.map(s => s.slice(0, 12)),
        type: 'heatmap',
        colorscale: 'RdBu',
        reversescale: true,
        hovertemplate: '%{y} vs %{x}<br>Distance: %{z:.4f}<extra></extra>',
      }]}
      layout={{
        height: Math.max(400, n * 40),
        margin: { t: 10, b: 80, l: 80, r: 20 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
    />
  )
}
