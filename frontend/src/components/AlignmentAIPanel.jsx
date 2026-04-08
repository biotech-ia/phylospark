import { useState, useRef, useEffect } from 'react'
import { Brain, Send, Loader2, MessageCircle } from 'lucide-react'
import DOIReferences from './DOIReferences'
import MarkdownRenderer from './MarkdownRenderer'
import api from '../api'

export default function AlignmentAIPanel({ experimentId, initialMessages = [] }) {
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef(null)
  const restoredRef = useRef(false)

  // Restore chat history from saved insights (each DB record → user + assistant message)
  useEffect(() => {
    if (restoredRef.current || !initialMessages.length) return
    restoredRef.current = true
    const restored = []
    for (const ins of initialMessages) {
      if (ins.user_prompt) restored.push({ role: 'user', content: ins.user_prompt })
      if (ins.ai_response) restored.push({ role: 'assistant', content: ins.ai_response, doi_references: ins.doi_references })
    }
    if (restored.length) setChatMessages(restored)
  }, [initialMessages])

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

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
        content: res.data.ai_response,
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

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Brain size={16} className="text-violet-500" />
            Alignment AI Chat
            <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">Chat</span>
          </h3>
        </div>
      </div>

      {/* Chat */}
      <div className="flex flex-col" style={{ height: '500px' }}>
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
                    <MarkdownRenderer text={msg.content} />
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
    </div>
  )
}
