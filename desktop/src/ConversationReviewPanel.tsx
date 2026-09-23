import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

type ConversationReviewFinding = {
  id: string
  category: string
  severity: string
  confidence: number
  title: string
  summary: string
  evidence: string
  remediation: string
}

type ConversationReview = {
  sourceFormat: string
  messagesReviewed: number
  charactersReviewed: number
  truncated: boolean
  findings: ConversationReviewFinding[]
}

const prettySource = (source: string) => {
  if (source === 'chatgpt-export') return 'ChatGPT export'
  if (source === 'claude-export') return 'Claude export'
  if (source === 'gemini-activity-export') return 'Gemini activity export'
  if (source === 'gemini-json-export') return 'Gemini JSON export'
  return 'Generic JSON conversation export'
}

export function ConversationReviewPanel() {
  const [selectedPath, setSelectedPath] = useState('')
  const [consent, setConsent] = useState(false)
  const [review, setReview] = useState<ConversationReview | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const selectExport = async () => {
    const selected = await openDialog({
      directory: false,
      multiple: false,
      title: 'Choose a conversation export to review locally',
      filters: [{ name: 'Conversation JSON export', extensions: ['json'] }],
    })

    if (typeof selected !== 'string') return
    setSelectedPath(selected)
    setConsent(false)
    setReview(null)
    setMessage('Export selected. CashPatch has not read it yet.')
  }

  const reviewLocally = async () => {
    if (!selectedPath || !consent || busy) return
    setBusy(true)
    setMessage('Reviewing the user-selected export locally…')
    try {
      const result = await invoke<ConversationReview>('conversation_review_import', {
        path: selectedPath,
        consent: true,
      })
      setReview(result)
      setMessage(
        result.findings.length
          ? `${result.findings.length} review finding${result.findings.length === 1 ? '' : 's'} found locally.`
          : 'No review findings were detected in this export.',
      )
    } catch (error) {
      setReview(null)
      setMessage(String(error))
    } finally {
      setBusy(false)
      setConsent(false)
    }
  }

  const clearReview = () => {
    setSelectedPath('')
    setConsent(false)
    setReview(null)
    setMessage('Local conversation review cleared from this screen.')
  }

  return <section className="panel">
    <p className="eyebrow">AI CONVERSATION REVIEW</p>
    <h2>Review exported AI conversations locally.</h2>
    <p className="muted">
      CashPatch supports user-selected ChatGPT, Claude and Gemini JSON exports. It does not sign in to those services,
      scrape accounts, extract browser passwords, read session cookies or bypass provider protections. The export is read
      only after you explicitly select it and confirm consent.
    </p>

    <div className="permission-list">
      <article>
        <div>
          <b>Conversation export</b>
          <small>{selectedPath || 'No export selected. CashPatch has read nothing.'}</small>
        </div>
        <div className="button-row">
          <button onClick={selectExport}>Choose JSON export</button>
          {selectedPath && <button className="secondary" onClick={clearReview}>Clear</button>}
        </div>
      </article>

      {selectedPath && <article>
        <div>
          <b>Explicit local review consent</b>
          <small>
            Analysis stays on this computer. If Ollama or LM Studio is available, CashPatch may use that local model only;
            there is no hosted-AI fallback. Potential credentials are redacted from finding evidence.
          </small>
        </div>
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={event => setConsent(event.target.checked)}
          />{' '}
          I consent to CashPatch reading and reviewing this selected export locally
        </label>
      </article>}
    </div>

    {selectedPath && <div className="button-row">
      <button disabled={!consent || busy} onClick={reviewLocally}>{busy ? 'Reviewing…' : 'Start local review'}</button>
    </div>}

    {message && <p className="status">{message}</p>}

    {review && <>
      <div className="trust">
        <div><strong>{prettySource(review.sourceFormat)}</strong><span>source format</span></div>
        <div><strong>{review.messagesReviewed.toLocaleString()}</strong><span>messages reviewed</span></div>
        <div><strong>{review.charactersReviewed.toLocaleString()}</strong><span>characters reviewed</span></div>
      </div>
      {review.truncated && <p className="status">Safety limits were reached. The result covers the bounded local review window rather than the entire export.</p>}

      <div className="local-findings">
        {review.findings.map(finding => <article className="local-finding" key={finding.id}>
          <div className="local-finding-top">
            <span>{finding.category.replaceAll('_', ' ')}</span>
            <strong>{finding.severity}</strong>
          </div>
          <h3>{finding.title}</h3>
          <div className="status-line"><span>Confidence</span><strong>{finding.confidence}%</strong></div>
          <p><b>Why this stands out:</b> {finding.summary}</p>
          <small>Evidence: {finding.evidence}</small>
          <div className="local-next"><span>RECOMMENDED HUMAN ACTION</span><b>{finding.remediation}</b></div>
          <small>Review only · CashPatch executed nothing.</small>
        </article>)}
        {!review.findings.length && <article className="local-finding">
          <h3>No conversation-review findings in this pass.</h3>
          <p>CashPatch changed nothing and did not send the export anywhere.</p>
        </article>}
      </div>
    </>}
  </section>
}
