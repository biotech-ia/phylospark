import { useState, useRef, useEffect } from 'react'
import { Brain, Send, Loader2, FileText, MessageCircle, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import DOIReferences, { DOIBadge } from './DOIReferences'
import api from '../api'

function SimpleMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold text-gray-800 mt-4 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-gray-800 mt-5 mb-2">{line.slice(3)}</h2>
        if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-gray-900 mt-5 mb-2">{line.slice(2)}</h1>
        if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (line.match(/^\d+\.\s/)) return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (line.trim() === '') return <br key={i} />
        return <p key={i} className="text-sm mb-1">{formatInline(line)}</p>
      })}
    </div>
  )
}

function formatInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    return part
  })
}

export default function AlignmentAIPanel({ experimentId }) {
  const [activeTab, setActiveTab] = useState('report')
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [showFullReport, setShowFullReport] = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const generateReport = async () => {
    setReportLoading(true)
    setReportError(null)
    try {
      const res = await api.ai.alignmentReport(experimentId, {})
      setReport(res.data)
    } catch (err) {
      setReportError(err.response?.data?.detail || 'Failed to generate report')
    } finally {
      setReportLoading(false)
    }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setChatLoading(true)

    try {
      const history = chatMessages.map(m => ({ role: m.role, content: m.content }))
      const res = await api.ai.alignmentChat(experimentId, {
        user_prompt: userMsg,
        conversation_history: history,
      })
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.analysis,
        doi_references: res.data.doi_references,
      }])
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.response?.data?.detail || 'Failed to get response'}`,
      }])
    } finally {
      setChatLoading(false)
    }
  }

  const tabs = [
    { id: 'report', label: 'Deep Analysis', icon: FileText },
    { id: 'chat', label: 'AI Chat', icon: MessageCircle },
  ]

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Brain size={16} className="text-violet-500" />
            Alignment AI Analysis
            <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">DeepSeek</span>
          </h3>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-violet-500 text-violet-700 bg-violet-50/50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            <tab.icon size={13} />
            {tab.label}
            {tab.id === 'chat' && chatMessages.length > 0 && (
              <span className="bg-violet-200 text-violet-700 text-[9px] px-1.5 py-0.5 rounded-full">
                {chatMessages.filter(m => m.role === 'user').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Report Tab */}
      {activeTab === 'report' && (
        <div className="p-4">
          {!report && !reportLoading && (
            <div className="text-center py-8">
              <Sparkles size={32} className="mx-auto text-violet-300 mb-3" />
              <p className="text-sm text-gray-500 mb-4">
                Generate a comprehensive deep analysis of your multiple sequence alignment
                with DOI-validated scientific references.
              </p>
              <button onClick={generateReport}
                className="px-5 py-2.5 bg-gradient-to-r from-violet-500 to-indigo-500 text-white rounded-lg text-sm font-medium hover:from-violet-600 hover:to-indigo-600 transition-all shadow-lg shadow-violet-200 flex items-center gap-2 mx-auto">
                <Brain size={16} />
                Generate Deep MSA Report
              </button>
              {reportError && (
                <p className="text-xs text-red-500 mt-3">{reportError}</p>
              )}
            </div>
          )}

          {reportLoading && (
            <div className="text-center py-12">
              <Loader2 size={28} className="animate-spin text-violet-500 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Analyzing alignment with AI...</p>
              <p className="text-[10px] text-gray-400 mt-1">This may take 30-60 seconds</p>
            </div>
          )}

          {report && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <FileText size={14} className="text-violet-500" />
                  MSA Deep Analysis Report
                  {report.doi_references && <DOIBadge references={report.doi_references} />}
                </h4>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowFullReport(!showFullReport)}
                    className="text-[10px] flex items-center gap-1 text-violet-600 hover:text-violet-800">
                    {showFullReport ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showFullReport ? 'Collapse' : 'Expand'}
                  </button>
                  <button onClick={generateReport}
                    className="text-[10px] flex items-center gap-1 text-gray-500 hover:text-gray-700">
                    <RefreshCw size={10} /> Regenerate
                  </button>
                </div>
              </div>

              <div className={`${showFullReport ? '' : 'max-h-96'} overflow-y-auto rounded-lg bg-gray-50 p-4 border`}>
                <SimpleMarkdown text={report.analysis} />
              </div>

              {report.doi_references && <DOIReferences references={report.doi_references} />}
            </div>
          )}
        </div>
      )}

      {/* Chat Tab */}
      {activeTab === 'chat' && (
        <div className="flex flex-col" style={{ height: '500px' }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center py-8">
                <MessageCircle size={28} className="mx-auto text-indigo-300 mb-3" />
                <p className="text-sm text-gray-500">Ask questions about your alignment</p>
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {[
                    'What are the most conserved regions?',
                    'Explain the gap patterns',
                    'Which sequences are most similar?',
                    'Identify potential functional domains',
                  ].map(q => (
                    <button key={q} onClick={() => { setChatInput(q) }}
                      className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 border border-indigo-100">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-violet-500 text-white'
                    : 'bg-gray-100 text-gray-800 border border-gray-200'
                }`}>
                  {msg.role === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <div>
                      <SimpleMarkdown text={msg.content} />
                      {msg.doi_references && msg.doi_references.length > 0 && (
                        <DOIReferences references={msg.doi_references} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-xl px-4 py-3 border border-gray-200">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 size={14} className="animate-spin" />
                    Analyzing...
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3 bg-gray-50">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Ask about your alignment..."
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                disabled={chatLoading}
              />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2.5 bg-violet-500 text-white rounded-xl hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                <Send size={16} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 text-center">
              AI has full context of your alignment data. Chat history is preserved across messages.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
