import { useState } from 'react'
import { DeptIcon, SendIcon } from './Icons'
import './BulletinTab.css'

interface BroadcastResponse {
  deptId: string
  name: string
  reply: string
}

interface BulletinTabProps {
  bulletin: string
}

export default function BulletinTab({ bulletin }: BulletinTabProps) {
  const [command, setCommand] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)
  const [responses, setResponses] = useState<BroadcastResponse[]>([])
  const [error, setError] = useState<string | null>(null)

  const broadcast = async () => {
    if (!command.trim() || broadcasting) return
    const cmd = command.trim()
    setCommand('')
    setBroadcasting(true)
    setResponses([])
    setError(null)

    try {
      const res = await fetch('/cmd/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      })
      const data = await res.json()
      if (data.success && data.responses) {
        const hasErrors = data.responses.some((r: BroadcastResponse) => r.reply.startsWith('[Error]'))
        if (hasErrors) {
          setError('部分部门回复失败（API 限额可能已用完）')
        }
        setResponses(data.responses)
      } else {
        setError(data.error || '广播失败')
      }
    } catch {
      setError('网络错误，请检查服务器连接')
    }
    setBroadcasting(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      broadcast()
    }
  }

  return (
    <div className="bulletin-tab">
      {/* Broadcast input */}
      <div className="broadcast-bar">
        <textarea
          className="broadcast-input"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="发布全公司命令..."
          rows={1}
          disabled={broadcasting}
        />
        <button
          className="broadcast-btn"
          onClick={broadcast}
          disabled={broadcasting || !command.trim()}
        >
          {broadcasting ? '...' : <SendIcon size={14} color="#ff6b35" />}
        </button>
      </div>

      {/* Broadcasting indicator */}
      {broadcasting && (
        <div className="broadcast-status">
          广播中... 等待所有部门逐一回复（约30秒）
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="broadcast-error">
          {error}
        </div>
      )}

      {/* Responses from all departments */}
      {responses.length > 0 && (
        <div className="broadcast-responses">
          <div className="broadcast-responses-title">各部门回复 ({responses.length})</div>
          {responses.map((resp, i) => (
            <div key={i} className={`broadcast-response ${resp.reply.startsWith('[Error]') ? 'error' : ''}`}>
              <div className="broadcast-response-header">
                <DeptIcon deptId={resp.deptId} size={14} />
                <span className="broadcast-dept-name">{resp.name}</span>
              </div>
              <div className="broadcast-response-text">{resp.reply}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bulletin content */}
      {!responses.length && !broadcasting && (
        <div className="bulletin-content">
          {bulletin ? (
            <pre className="markdown-content" style={{ whiteSpace: 'pre-wrap' }}>{bulletin}</pre>
          ) : (
            <div className="bulletin-empty">
              <p>发布命令到全公司广播</p>
              <p className="bulletin-hint">所有部门将收到命令并回复执行计划</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
