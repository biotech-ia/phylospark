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
  getStats: (id) => api.get(`/experiments/${id}/stats`),
  getLogs: (id) => api.get(`/experiments/${id}/logs`),
}

export const ncbi = {
  search: (data) => api.post('/ncbi/search', data),
}

export const ai = {
  recommendSequences: (data) => api.post('/ai/recommend-sequences', data),
  recommendAlignmentParams: (data) => api.post('/ai/recommend-alignment-params', data),
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
