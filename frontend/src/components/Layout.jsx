import { Link } from 'react-router-dom'

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to="/" className="flex items-center space-x-2">
              <span className="text-2xl">🧬</span>
              <span className="text-xl font-bold text-phylo-700">PhyloSpark</span>
            </Link>
            <div className="flex items-center space-x-4">
              <Link to="/" className="text-gray-600 hover:text-phylo-600 font-medium">
                Dashboard
              </Link>
              <Link
                to="/new"
                className="bg-phylo-600 text-white px-4 py-2 rounded-lg hover:bg-phylo-700 transition-colors"
              >
                + New Experiment
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
