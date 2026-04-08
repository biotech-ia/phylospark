import { createContext, useState, useEffect } from 'react'
import { ai } from '../api'

export const ModelContext = createContext({
  chatModel: 'deepseek-chat',
  reasoningModel: 'deepseek-reasoner',
  setChatModel: () => {},
  setReasoningModel: () => {},
  availableModels: [],
  modelsLoading: true,
})

export function ModelProvider({ children }) {
  const [chatModel, setChatModelState] = useState(
    () => localStorage.getItem('phylo_chat_model') || 'deepseek-chat'
  )
  const [reasoningModel, setReasoningModelState] = useState(
    () => localStorage.getItem('phylo_reasoning_model') || 'deepseek-reasoner'
  )
  const [availableModels, setAvailableModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(true)

  useEffect(() => {
    ai.models()
      .then(res => {
        setAvailableModels(res.data)
        // Set defaults from server if current selection isn't available
        const chatDefault = res.data.find(m => m.is_default && m.type === 'chat')
        const reasonDefault = res.data.find(m => m.is_default && m.type === 'reasoning')
        if (chatDefault && !res.data.find(m => m.id === chatModel)) {
          setChatModelState(chatDefault.id)
        }
        if (reasonDefault && !res.data.find(m => m.id === reasoningModel)) {
          setReasoningModelState(reasonDefault.id)
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
  }, [])

  const setChatModel = (id) => {
    setChatModelState(id)
    localStorage.setItem('phylo_chat_model', id)
  }
  const setReasoningModel = (id) => {
    setReasoningModelState(id)
    localStorage.setItem('phylo_reasoning_model', id)
  }

  return (
    <ModelContext.Provider value={{
      chatModel, reasoningModel, setChatModel, setReasoningModel,
      availableModels, modelsLoading,
    }}>
      {children}
    </ModelContext.Provider>
  )
}
