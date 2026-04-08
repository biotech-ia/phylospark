import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export const experiments = {
  list: (skip = 0, limit = 20) => api.get(`/experiments/?skip=${skip}&limit=${limit}`),
  get: (id) => api.get(`/experiments/${id}`),
  create: (data) => api.post('/experiments/', data),
  run: (id) => api.post(`/experiments/${id}/run`),
  stop: (id) => api.post(`/experiments/${id}/stop`),
  delete: (id) => api.delete(`/experiments/${id}`),
  getTree: (id) => api.get(`/experiments/${id}/tree`),
  getAlignment: (id) => api.get(`/experiments/${id}/alignment`),
  getAlignmentStats: (id) => api.get(`/experiments/${id}/alignment-stats`),
  getStats: (id) => api.get(`/experiments/${id}/stats`),
  getLogs: (id) => api.get(`/experiments/${id}/logs`),
  getTaxonMeta: (id) => api.get(`/experiments/${id}/taxon-metadata`),
  getInsights: (id) => api.get(`/experiments/${id}/insights`),
}

export const ncbi = {
  search: (data) => api.post('/ncbi/search', data),
}

export const ai = {
  recommendSequences: (data) => api.post('/ai/recommend-sequences', data),
  recommendAlignmentParams: (data) => api.post('/ai/recommend-alignment-params', data),
  taxonInsight: (experimentId, data) => api.post(`/ai/experiments/${experimentId}/taxon-insight`, data),
  treeInsight: (experimentId, data) => api.post(`/ai/experiments/${experimentId}/tree-insight`, data),
  advancedReport: (experimentId, data = {}) => api.post(`/ai/experiments/${experimentId}/advanced-report`, data),
  alignmentReport: (experimentId, data = {}) => api.post(`/ai/experiments/${experimentId}/alignment-report`, data),
  alignmentChat: (experimentId, data) => api.post(`/ai/experiments/${experimentId}/alignment-chat`, data),
  statsReport: (experimentId, data = {}) => api.post(`/ai/experiments/${experimentId}/stats-report`, data),
  // New endpoints
  models: () => api.get('/ai/models'),
  modelHealth: (modelId) => api.get(`/ai/models/${modelId}/health`),
  cachedAnalysis: (experimentId, scope) => api.get(`/ai/experiments/${experimentId}/cached-analysis?scope=${scope}`),
  chartAnalysis: (experimentId, data) => api.post(`/ai/experiments/${experimentId}/chart-analysis`, data),
}

export function connectExperimentWS(experimentId, onMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/experiments/${experimentId}/logs`)
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onMessage(data)
    } catch (e) {
      console.warn('WS parse error:', e)
    }
  }
  ws.onerror = (e) => console.error('WS error:', e)
  return ws
}

export default api
