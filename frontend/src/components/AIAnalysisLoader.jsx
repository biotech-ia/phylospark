import { Sparkles } from 'lucide-react'

const sizeClasses = {
  sm: { wrapper: 'p-3', icon: 16, title: 'text-xs', badge: 'text-xs px-2 py-0.5' },
  md: { wrapper: 'p-5', icon: 20, title: 'text-sm', badge: 'text-xs px-3 py-1' },
  lg: { wrapper: 'p-6', icon: 24, title: 'text-base', badge: 'text-sm px-3 py-1.5' },
}

export default function AIAnalysisLoader({
  loading = true,
  steps = [
    { label: 'Analyzing data' },
    { label: 'Extracting features' },
    { label: 'Searching DOIs' },
    { label: 'Validating references' },
  ],
  title = 'Generating analysis...',
  subtitle = 'AI agent is processing your data',
  gradientFrom = 'from-indigo-500',
  gradientTo = 'to-purple-500',
  size = 'md',
}) {
  if (!loading) return null

  const s = sizeClasses[size] || sizeClasses.md

  return (
    <div className={`${s.wrapper} rounded-xl bg-gradient-to-br ${gradientFrom} ${gradientTo} text-white`}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={s.icon} className="animate-spin" />
        <span className={`font-semibold ${s.title}`}>{title}</span>
      </div>
      {size !== 'sm' && (
        <p className="text-white/70 text-xs mb-3">{subtitle}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {steps.map((step, i) => (
          <span
            key={i}
            className={`${s.badge} bg-white/20 rounded-full animate-pulse font-medium`}
            style={{ animationDelay: `${i * 0.3}s` }}
          >
            {step.icon && <span className="mr-1">{step.icon}</span>}
            {step.label}
          </span>
        ))}
      </div>
    </div>
  )
}
