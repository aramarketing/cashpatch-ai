import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { openUrl } from '@tauri-apps/plugin-opener'
import { check } from '@tauri-apps/plugin-updater'
import { notifyFinding } from './notifications'

type PairStart = {
  pairingCode: string
  approveUrl: string
  expiresAt: string
}

type PairConsume = {
  state: 'pending' | 'paired'
}

type Entitlement = {
  paired: boolean
  allowed: boolean
  billingStatus?: string
  plan?: string
}

type LocalAiRuntime = {
  key: string
  name: string
  endpoint: string
  available: boolean
}

type DetectedSource = {
  key: string
  name: string
  kind: string
  installed: boolean
  permissionHint: string
}

type Phase = 'booting' | 'unpaired' | 'pairing' | 'blocked' | 'ready' | 'error'

const PORTAL = 'https://cashpatch-ai.vercel.app'

export default function App() {
  const [phase, setPhase] = useState<Phase>('booting')
  const [pair, setPair] = useState<PairStart | null>(null)
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [message, setMessage] = useState('Starting secure local watchdog…')
  const [autostart, setAutostart] = useState(false)
  const [localAi, setLocalAi] = useState<LocalAiRuntime[]>([])
  const [detectedSources, setDetectedSources] = useState<DetectedSource[]>([])
  const pollRef = useRef<number | null>(null)

  const refreshEntitlement = async () => {
    try {
      const status = await invoke<Entitlement>('entitlement_check')
      setEntitlement(status)
      if (!status.paired) setPhase('unpaired')
      else if (!status.allowed) setPhase('blocked')
      else setPhase('ready')
    } catch (error) {
      setMessage(String(error))
      setPhase('error')
    }
  }

  useEffect(() => {
    refreshEntitlement()
    isEnabled().then(setAutostart).catch(() => {})
    check().catch(() => null)
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return

    invoke<LocalAiRuntime[]>('discover_local_ai').then(setLocalAi).catch(() => setLocalAi([]))
    invoke<DetectedSource[]>('discover_supported_apps').then(setDetectedSources).catch(() => setDetectedSources([]))

    const id = window.setInterval(refreshEntitlement, 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
  }, [])

  const beginPairing = async () => {
    try {
      setMessage('Creating secure pairing request…')
      const result = await invoke<PairStart>('pair_start')
      setPair(result)
      setPhase('pairing')
      await openUrl(result.approveUrl)

      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        try {
          const consumed = await invoke<PairConsume>('pair_consume')
          if (consumed.state === 'paired') {
            if (pollRef.current) window.clearInterval(pollRef.current)
            pollRef.current = null
            await refreshEntitlement()
          }
        } catch {}
      }, 3000)
    } catch (error) {
      setMessage(String(error))
      setPhase('error')
    }
  }

  const enableAutostart = async () => {
    await enable()
    setAutostart(await isEnabled())
  }

  if (phase === 'booting') {
    return <div className="center"><div className="pulse">CP</div><h1>Starting CashPatch.</h1><p>{message}</p></div>
  }

  if (phase === 'unpaired') {
    return <div className="center card">
      <div className="pulse">CP</div>
      <p className="eyebrow">LOCAL AI WATCHDOG</p>
      <h1>Pair this computer.</h1>
      <p>CashPatch runs locally, watches only what you approve, and never changes connected systems.</p>
      <button onClick={beginPairing}>Pair this device</button>
      <small>macOS + Windows · Review-only by design</small>
    </div>
  }

  if (phase === 'pairing') {
    return <div className="center card">
      <p className="eyebrow">PAIRING IN PROGRESS</p>
      <h1>Approve this device.</h1>
      <div className="pair-code">{pair?.pairingCode}</div>
      <p>Your browser has opened the CashPatch approval page. After approval, this screen finishes automatically.</p>
      {pair && <button className="secondary" onClick={() => openUrl(pair.approveUrl)}>Open approval page</button>}
    </div>
  }

  if (phase === 'blocked') {
    return <div className="center card danger">
      <p className="eyebrow">MONITORING LOCKED</p>
      <h1>Active subscription required.</h1>
      <p>CashPatch is paired, but monitoring and local AI are disabled because the workspace is not currently paid and active.</p>
      <div className="status-line"><span>Billing</span><strong>{entitlement?.billingStatus ?? 'inactive'}</strong></div>
      <button onClick={() => openUrl(`${PORTAL}/dashboard`)}>Open billing portal</button>
      <small>Existing local findings remain visible. No background scan is running.</small>
    </div>
  }

  if (phase === 'error') {
    return <div className="center card danger">
      <p className="eyebrow">CASH PATCH STATUS</p>
      <h1>Monitoring stopped safely.</h1>
      <p>{message}</p>
      <button onClick={refreshEntitlement}>Retry secure check</button>
    </div>
  }

  return <div className="app">
    <aside>
      <div className="brand"><span>CP</span><strong>CashPatch</strong></div>
      <nav>
        <button className="active">Watchtower</button>
        <button>Findings</button>
        <button>Sources</button>
        <button>Permissions</button>
        <button>Local AI</button>
        <button>Activity</button>
        <button>Settings</button>
      </nav>
      <div className="review">REVIEW ONLY</div>
    </aside>
    <main>
      <header>
        <div><p className="eyebrow">LOCAL BUSINESS WATCHDOG</p><h1>Everything looks quiet.</h1></div>
        <div className="live"><i /> Monitoring armed</div>
      </header>

      <section className="trust">
        <div><strong>CashPatch can see.</strong><span>Approved sources only.</span></div>
        <div><strong>CashPatch cannot change.</strong><span>No send, edit, delete, click or type.</span></div>
        <div><strong>Subscription verified.</strong><span>{entitlement?.plan ?? 'paid'} · {entitlement?.billingStatus}</span></div>
      </section>

      <section className="grid">
        <article className="hero-panel">
          <p className="eyebrow">WATCHTOWER</p>
          <h2>No urgent findings yet.</h2>
          <p>Connect your first read-only source. CashPatch will correlate approved signals locally and notify you only when something deserves attention.</p>
          <button onClick={() => openUrl(`${PORTAL}/dashboard/sources`)}>Connect sources</button>
        </article>
        <article>
          <p className="eyebrow">LOCAL AI</p>
          <h3>{localAi.filter(runtime => runtime.available).length > 0 ? 'Local runtime detected' : 'No local runtime yet'}</h3>
          <p>{localAi.filter(runtime => runtime.available).map(runtime => runtime.name).join(', ') || 'CashPatch checked Ollama and LM Studio locally. Setup guidance comes next.'}</p>
        </article>
        <article>
          <p className="eyebrow">AUTOSTART</p>
          <h3>{autostart ? 'Starts with your computer' : 'Manual start'}</h3>
          {!autostart && <button className="secondary" onClick={enableAutostart}>Enable autostart</button>}
        </article>
        <article>
          <p className="eyebrow">SOURCES DISCOVERED</p>
          <h3>{detectedSources.filter(source => source.installed).length} supported apps found</h3>
          <p>{detectedSources.filter(source => source.installed).map(source => source.name).join(', ') || 'CashPatch did not find a supported local app yet.'}</p>
          {detectedSources.some(source => source.installed) && <button className="secondary" onClick={() => openUrl(`${PORTAL}/dashboard/sources`)}>Review permissions</button>}
        </article>
        <article>
          <p className="eyebrow">UPDATES</p>
          <h3>Signed update channel</h3>
          <p>Update infrastructure is wired; public signed desktop releases are the next release step.</p>
          <button className="secondary" onClick={() => notifyFinding('CashPatch alert test', 'Native notifications are ready. Real findings will appear here automatically.')}>Test desktop alert</button>
        </article>
      </section>
    </main>
  </div>
}
