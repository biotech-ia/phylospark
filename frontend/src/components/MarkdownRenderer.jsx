/**
 * Shared Markdown renderer for AI responses.
 * Supports: headers, bold, italic, links, inline code, ordered/unordered lists.
 */

function parseInline(text) {
  if (!text) return text
  const parts = []
  let remaining = String(text)
  let key = 0

  while (remaining.length > 0) {
    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      parts.push(
        <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline decoration-blue-300 hover:decoration-blue-500 transition-colors">
          {linkMatch[1]}
        </a>
      )
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-semibold text-gray-800">{parseInline(boldMatch[1])}</strong>)
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/)
    if (italicMatch) {
      parts.push(<em key={key++} className="italic text-gray-700">{parseInline(italicMatch[1])}</em>)
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 bg-gray-100 text-gray-800 rounded text-xs font-mono">
          {codeMatch[1]}
        </code>
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Regular text — accumulate until next special char
    const nextSpecial = remaining.slice(1).search(/[\[*`]/)
    if (nextSpecial === -1) {
      parts.push(remaining)
      break
    } else {
      parts.push(remaining.slice(0, nextSpecial + 1))
      remaining = remaining.slice(nextSpecial + 1)
    }
  }

  return parts.length === 1 ? parts[0] : parts
}

export default function MarkdownRenderer({ text, className = '' }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Headers
    if (line.startsWith('#### ')) {
      elements.push(<h5 key={i} className="font-semibold text-gray-700 mt-2 mb-1 text-sm">{parseInline(line.slice(5))}</h5>)
    } else if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-gray-800 mt-3 mb-1 text-sm">{parseInline(line.slice(4))}</h4>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="font-bold text-gray-800 mt-4 mb-2 text-base">{parseInline(line.slice(3))}</h3>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="font-bold text-gray-900 mt-5 mb-2 text-lg">{parseInline(line.slice(2))}</h2>)
    }
    // Unordered list
    else if (line.match(/^[-*] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(
          <li key={i} className="text-gray-700 text-sm leading-relaxed">
            {parseInline(lines[i].replace(/^[-*] /, ''))}
          </li>
        )
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-outside space-y-1 my-2 ml-5">{items}</ul>)
      continue
    }
    // Ordered list
    else if (line.match(/^\d+\.\s/)) {
      const items = []
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(
          <li key={i} className="text-gray-700 text-sm leading-relaxed">
            {parseInline(lines[i].replace(/^\d+\.\s/, ''))}
          </li>
        )
        i++
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-outside space-y-1 my-2 ml-5">{items}</ol>)
      continue
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    }
    // Regular paragraph
    else {
      elements.push(
        <p key={i} className="text-gray-700 text-sm leading-relaxed mb-1">
          {parseInline(line)}
        </p>
      )
    }
    i++
  }

  return <div className={`max-w-none ${className}`}>{elements}</div>
}
