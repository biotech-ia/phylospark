import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import NewExperiment from './pages/NewExperiment'
import ExperimentDetail from './pages/ExperimentDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewExperiment />} />
        <Route path="/experiment/:id" element={<ExperimentDetail />} />
      </Routes>
    </Layout>
  )
}
