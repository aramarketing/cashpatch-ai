import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
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

type CloudSource = {
  id: string
  provider: string
  category: string
  displayName?: string | null
  status: string
  scopes: string[]
  capabilities: string[]
  permissionMode: string
  externalWriteAllowed: boolean
  updatedAt?: string | null
}

type QuickScanPlan = {
  roots: string[]
  filesSeen: number
  directoriesSeen: number
  bytesSeen: number
  permissionDenied: number
  truncated: boolean
  estimatedFullSeconds: number
  estimatedFullLabel: string
}

type LocalFinding = {
  id: string
  category: string
  severity: string
  title: string
  summary: string
  evidence: string
  remediation: string
}

type VaultStatus = {
  exists: boolean
  unlocked: boolean
  autoLockSeconds: number
}

type VaultEntrySummary = {
  id: string
  label: string
  username: string
  url: string
  notes: string
  createdAtEpoch: number
  updatedAtEpoch: number
}

type ScanSnapshot = {
  scanId?: string | null
  mode: string
  phase: string
  currentItem?: string | null
  filesSeen: number
  directoriesSeen: number
  bytesSeen: number
  permissionDenied: number
  findingsCount: number
  progressPercent: number
  elapsedSeconds: number
  etaSeconds?: number | null
  paused: boolean
  cancelled: boolean
  quickPlan?: QuickScanPlan | null
  findings: LocalFinding[]
  error?: string | null
}

type Phase = 'booting' | 'unpaired' | 'pairing' | 'blocked' | 'ready' | 'error'
type Section = 'watchtower' | 'scan' | 'findings' | 'sources' | 'permissions' | 'ai' | 'vault' | 'activity' | 'subscription' | 'settings'

const PORTAL = 'https://cashpatch-ai.vercel.app'

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

const formatEta = (seconds?: number | null) => {
  if (seconds == null) return 'Estimating…'
  if (seconds < 60) return `${Math.max(1, seconds)} sec`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
  return `${Math.ceil(seconds / 3600)} h`
}


const navigation: Array<[Section, string]> = [
  ['watchtower', 'Watchtower'],
  ['scan', 'Scan'],
  ['findings', 'Findings'],
  ['sources', 'Sources'],
  ['permissions', 'Permissions'],
  ['ai', 'Local AI'],
  ['vault', 'Password Vault'],
  ['activity', 'Activity'],
  ['subscription', 'Subscription'],
  ['settings', 'Settings'],
]

const cloudSources = [
  { name: 'Bank accounts', kind: 'Banking', detail: 'Balances + transactions only · never payment initiation' },
  { name: 'Microsoft Outlook', kind: 'Email', detail: 'Read-only Mail.Read permission' },
  { name: 'Gmail', kind: 'Email', detail: 'Read-only mailbox permission' },
  { name: 'Stripe', kind: 'Payments', detail: 'Restricted read-only account access' },
  { name: 'HubSpot', kind: 'CRM', detail: 'Read-only CRM scopes' },
  { name: 'ClickUp', kind: 'Project management', detail: 'Read-only workspace access' },
]

export default function App() {
  const [phase, setPhase] = useState<Phase>('booting')
  const [section, setSection] = useState<Section>('watchtower')
  const [pair, setPair] = useState<PairStart | null>(null)
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [message, setMessage] = useState('Starting secure local watchdog…')
  const [autostart, setAutostart] = useState(false)
  const [localAi, setLocalAi] = useState<LocalAiRuntime[]>([])
  const [detectedSources, setDetectedSources] = useState<DetectedSource[]>([])
  const [approvedFolder, setApprovedFolder] = useState<string | null>(null)
  const [connectedSources, setConnectedSources] = useState<CloudSource[]>([])
  const [scanSnapshot, setScanSnapshot] = useState<ScanSnapshot | null>(null)
  const [quickConsent, setQuickConsent] = useState(false)
  const [fullConsent, setFullConsent] = useState(false)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [vaultEntries, setVaultEntries] = useState<VaultEntrySummary[]>([])
  const [vaultMaster, setVaultMaster] = useState('')
  const [vaultLabel, setVaultLabel] = useState('')
  const [vaultUsername, setVaultUsername] = useState('')
  const [vaultSecret, setVaultSecret] = useState('')
  const [vaultUrl, setVaultUrl] = useState('')
  const [vaultNotes, setVaultNotes] = useState('')
  const [revealedSecret, setRevealedSecret] = useState<{ id: string; value: string } | null>(null)
  const [vaultMessage, setVaultMessage] = useState('')
  const [jevEndpoint, setJevEndpoint] = useState('')
  const [customAiEndpoint, setCustomAiEndpoint] = useState('')
  const [localAiMessage, setLocalAiMessage] = useState('')
  const pollRef = useRef<number | null>(null)

  const availableAi = useMemo(() => localAi.filter(runtime => runtime.available), [localAi])
  const installedApps = useMemo(() => detectedSources.filter(source => source.installed), [detectedSources])

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

  const refreshLocalDiscovery = async () => {
    const [ai, sources, folder] = await Promise.all([
      invoke<LocalAiRuntime[]>('discover_local_ai').catch(() => []),
      invoke<DetectedSource[]>('discover_supported_apps').catch(() => []),
      invoke<string | null>('approved_folder_get').catch(() => null),
    ])
    setLocalAi(ai)
    setDetectedSources(sources)
    setApprovedFolder(folder)
  }

  const refreshBusinessSources = async () => {
    const sources = await invoke<CloudSource[]>('cloud_sources').catch(() => [])
    setConnectedSources(sources)
  }

  useEffect(() => {
    let disposed = false
    let stopListening: (() => void) | undefined

    invoke<ScanSnapshot>('scan_status').then(snapshot => {
      if (!disposed) setScanSnapshot(snapshot)
    }).catch(() => {})

    listen<ScanSnapshot>('scan-progress', event => {
      if (!disposed) setScanSnapshot(event.payload)
    }).then(unlisten => {
      if (disposed) unlisten()
      else stopListening = unlisten
    }).catch(() => {})

    return () => {
      disposed = true
      stopListening?.()
    }
  }, [])

  useEffect(() => {
    invoke<VaultStatus>('vault_status')
      .then(setVaultStatus)
      .catch(() => setVaultStatus(null))
  }, [])

  useEffect(() => {
    refreshEntitlement()
    isEnabled().then(setAutostart).catch(() => {})
    check().catch(() => null)
  }, [])

  useEffect(() => {
    if (phase === 'blocked') {
      const blockedTimer = window.setInterval(refreshEntitlement, 10 * 1000)
      return () => window.clearInterval(blockedTimer)
    }

    if (phase !== 'ready') return
    refreshLocalDiscovery()
    refreshBusinessSources()
    const entitlementTimer = window.setInterval(refreshEntitlement, 5 * 60 * 1000)
    return () => {
      window.clearInterval(entitlementTimer)
    }
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
      setMessage('Waiting for browser approval…')
      await openUrl(result.approveUrl)

      if (pollRef.current) window.clearInterval(pollRef.current)

      const pollPairing = async (): Promise<'pending' | 'paired' | 'expired'> => {
        if (Date.now() >= Date.parse(result.expiresAt)) {
          if (pollRef.current) window.clearInterval(pollRef.current)
          pollRef.current = null
          setMessage('This pairing code expired. Start a new pairing request.')
          return 'expired'
        }

        try {
          const consumed = await invoke<PairConsume>('pair_consume')
          if (consumed.state === 'paired') {
            if (pollRef.current) window.clearInterval(pollRef.current)
            pollRef.current = null
            setMessage('Device approved. Verifying subscription…')
            await refreshEntitlement()
            return 'paired'
          }

          setMessage('Waiting for browser approval…')
          return 'pending'
        } catch (error) {
          setMessage(`Pairing service error. Retrying automatically: ${String(error)}`)
          return 'pending'
        }
      }

      const initialState = await pollPairing()
      if (initialState !== 'pending') return

      pollRef.current = window.setInterval(async () => {
        const state = await pollPairing()
        if (state !== 'pending' && pollRef.current) {
          window.clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 3000)
    } catch (error) {
      setMessage(String(error))
      setPhase('error')
    }
  }

  const setAutostartEnabled = async (nextEnabled: boolean) => {
    if (nextEnabled) await enable()
    else await disable()
    setAutostart(await isEnabled())
  }

  const chooseFolder = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Choose a folder CashPatch may review',
    })
    if (typeof selected === 'string') {
      await invoke('approved_folder_set', { path: selected })
      setApprovedFolder(selected)
    }
  }

  const clearFolder = async () => {
    await invoke('approved_folder_clear')
    setApprovedFolder(null)
  }

  const startQuickScan = async () => {
    if (!quickConsent) return
    setSection('scan')
    const extraRoots = approvedFolder ? [approvedFolder] : []
    await invoke<string>('quick_scan_start', { consent: true, extraRoots })
  }

  const startFullScan = async () => {
    if (!fullConsent || !scanSnapshot?.scanId) return
    await invoke('full_scan_start', { scanId: scanSnapshot.scanId, consent: true })
  }

  const pauseOrResumeScan = async () => {
    if (!scanSnapshot) return
    if (scanSnapshot.paused) await invoke('scan_resume')
    else await invoke('scan_pause')
  }

  const cancelScan = async () => {
    await invoke('scan_cancel')
  }

  const refreshVault = async () => {
    const status = await invoke<VaultStatus>('vault_status')
    setVaultStatus(status)
    if (status.unlocked) {
      setVaultEntries(await invoke<VaultEntrySummary[]>('vault_list_entries'))
    } else {
      setVaultEntries([])
      setRevealedSecret(null)
    }
  }

  const createVault = async () => {
    try {
      const status = await invoke<VaultStatus>('vault_create', { masterPassword: vaultMaster })
      setVaultStatus(status)
      setVaultMaster('')
      setVaultMessage('Encrypted local vault created.')
      await refreshVault()
    } catch (error) {
      setVaultMessage(String(error))
    }
  }

  const unlockVault = async () => {
    try {
      const status = await invoke<VaultStatus>('vault_unlock', { masterPassword: vaultMaster })
      setVaultStatus(status)
      setVaultMaster('')
      setVaultMessage('Vault unlocked locally.')
      await refreshVault()
    } catch (error) {
      setVaultMessage(String(error))
    }
  }

  const lockVault = async () => {
    await invoke('vault_lock')
    setVaultMaster('')
    setVaultEntries([])
    setRevealedSecret(null)
    setVaultMessage('Vault locked.')
    await refreshVault()
  }

  const addVaultEntry = async () => {
    try {
      await invoke<string>('vault_add_entry', {
        label: vaultLabel,
        username: vaultUsername,
        secret: vaultSecret,
        url: vaultUrl,
        notes: vaultNotes,
      })
      setVaultLabel('')
      setVaultUsername('')
      setVaultSecret('')
      setVaultUrl('')
      setVaultNotes('')
      setVaultMessage('Entry encrypted and saved locally.')
      await refreshVault()
    } catch (error) {
      setVaultMessage(String(error))
    }
  }

  const revealVaultEntry = async (entryId: string) => {
    try {
      const value = await invoke<string>('vault_get_secret', { entryId })
      setRevealedSecret({ id: entryId, value })
      window.setTimeout(() => {
        setRevealedSecret(current => current?.id === entryId ? null : current)
      }, 30_000)
    } catch (error) {
      setVaultMessage(String(error))
    }
  }

  const removeVaultEntry = async (entryId: string) => {
    try {
      await invoke('vault_remove_entry', { entryId })
      setRevealedSecret(null)
      setVaultMessage('Entry removed from the encrypted vault.')
      await refreshVault()
    } catch (error) {
      setVaultMessage(String(error))
    }
  }

  const saveLocalAiEndpoint = async (provider: 'jev' | 'custom-local', endpoint: string) => {
    try {
      await invoke('local_ai_endpoint_set', { provider, endpoint })
      setLocalAiMessage(`${provider === 'jev' ? 'Jev' : 'Custom local AI'} endpoint saved locally.`)
      await refreshLocalDiscovery()
    } catch (error) {
      setLocalAiMessage(String(error))
    }
  }

  const clearLocalAiEndpoint = async (provider: 'jev' | 'custom-local') => {
    await invoke('local_ai_endpoint_clear', { provider })
    if (provider === 'jev') setJevEndpoint('')
    else setCustomAiEndpoint('')
    setLocalAiMessage('Local AI endpoint removed.')
    await refreshLocalDiscovery()
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
      <p className="status">{message}</p>
      <div className="button-row">
        {pair && <button className="secondary" onClick={() => openUrl(pair.approveUrl)}>Open approval page</button>}
        {message.includes('expired') && <button onClick={beginPairing}>Start new pairing</button>}
      </div>
    </div>
  }

  if (phase === 'blocked') {
    return <div className="center card danger">
      <p className="eyebrow">MONITORING LOCKED</p>
      <h1>Active subscription required.</h1>
      <p>CashPatch is paired, but monitoring and local AI are disabled because the workspace is not currently paid and active.</p>
      <div className="status-line"><span>Billing</span><strong>{entitlement?.billingStatus ?? 'inactive'}</strong></div>
      <div className="button-row">
        <button onClick={() => openUrl(`${PORTAL}/dashboard`)}>Open billing portal</button>
        <button className="secondary" onClick={refreshEntitlement}>Check subscription now</button>
      </div>
      <small>CashPatch rechecks the server automatically every 10 seconds. Existing local findings remain visible. No background scan is running.</small>
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

  const title = navigation.find(([key]) => key === section)?.[1] ?? 'CashPatch'

  return <div className="app">
    <aside>
      <div className="brand"><span>CP</span><strong>CashPatch</strong></div>
      <nav>
        {navigation.map(([key, label]) => (
          <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>
      <div className="review">REVIEW ONLY</div>
    </aside>

    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL BUSINESS WATCHDOG</p>
          <h1>{section === 'watchtower' ? 'Everything that deserves attention.' : title}</h1>
        </div>
        <div className="live"><i /> Monitoring armed</div>
      </header>

      <section className="trust">
        <div><strong>CashPatch can see.</strong><span>Approved sources only.</span></div>
        <div><strong>CashPatch cannot change.</strong><span>No send, edit, delete, click or type.</span></div>
        <div><strong>Subscription verified.</strong><span>{entitlement?.plan ?? 'paid'} · {entitlement?.billingStatus}</span></div>
      </section>

      {section === 'watchtower' && <section className="grid">
        <article className="hero-panel">
          <p className="eyebrow">WATCHTOWER</p>
          <h2>{(scanSnapshot?.findingsCount ?? 0) ? `${scanSnapshot?.findingsCount} local finding${scanSnapshot?.findingsCount === 1 ? '' : 's'} need review.` : 'No urgent findings yet.'}</h2>
          <p>{(scanSnapshot?.findingsCount ?? 0) ? 'CashPatch found local review-only signals worth checking. Nothing was changed on this computer or in any connected account.' : 'CashPatch is idle. No scan runs until you explicitly start one.'}</p>
          <button onClick={() => (scanSnapshot?.findingsCount ?? 0) ? setSection('findings') : setSection('scan')}>{(scanSnapshot?.findingsCount ?? 0) ? 'Review findings' : 'Start a scan'}</button>
        </article>
        <article>
          <p className="eyebrow">LOCAL AI</p>
          <h3>{availableAi.length ? 'Local runtime detected' : 'Local AI setup needed'}</h3>
          <p>{availableAi.map(runtime => runtime.name).join(', ') || 'Ollama and LM Studio were checked locally.'}</p>
          <button className="secondary" onClick={() => setSection('ai')}>Open Local AI</button>
        </article>
        <article>
          <p className="eyebrow">SOURCES DISCOVERED</p>
          <h3>{installedApps.length} supported apps found</h3>
          <p>{installedApps.map(source => source.name).join(', ') || 'No supported local app detected yet.'}</p>
          <button className="secondary" onClick={() => setSection('sources')}>Open sources</button>
        </article>
        <article>
          <p className="eyebrow">LOCAL FOLDER</p>
          <h3>{approvedFolder ? '1 folder approved' : 'No folder access'}</h3>
          <p>{approvedFolder ?? 'CashPatch reads no local folder until you explicitly choose one.'}</p>
          <button className="secondary" onClick={chooseFolder}>{approvedFolder ? 'Change folder' : 'Choose folder'}</button>
        </article>
        <article>
          <p className="eyebrow">ALERTS</p>
          <h3>Native notifications ready</h3>
          <p>Important findings can appear as desktop notifications without changing the source system.</p>
          <button className="secondary" onClick={() => notifyFinding('CashPatch alert test', 'Native notifications are ready. Real findings will appear here automatically.')}>Test alert</button>
        </article>
      </section>}

      {section === 'scan' && <section className="panel">
        <p className="eyebrow">LOCAL REVIEW-ONLY SCAN</p>
        <h2>Scan deeply. Change nothing.</h2>
        <p className="muted">CashPatch scans only after your explicit consent. Quick Scan inventories scope and estimates the Full Scan. Full Scan requires a second confirmation.</p>

        {(!scanSnapshot || scanSnapshot.phase === 'idle' || scanSnapshot.phase === 'cancelled') && <>
          <div className="permission-list">
            <article>
              <div>
                <b>Quick Scan consent</b>
                <small>Metadata only: accessible files, folders, installed application locations and permission boundaries. No background scan.</small>
              </div>
              <label><input type="checkbox" checked={quickConsent} onChange={e => setQuickConsent(e.target.checked)} /> I consent to a local read-only Quick Scan</label>
            </article>
          </div>
          <button disabled={!quickConsent} onClick={startQuickScan}>Start Quick Scan</button>
        </>}

        {scanSnapshot?.phase === 'quick_scanning' && <>
          <div className="status-line"><span>Phase</span><strong>Quick Scan</strong></div>
          <div className="status-line"><span>Files</span><strong>{scanSnapshot.filesSeen.toLocaleString()}</strong></div>
          <div className="status-line"><span>Data mapped</span><strong>{formatBytes(scanSnapshot.bytesSeen)}</strong></div>
          <div className="status-line"><span>Permission limits</span><strong>{scanSnapshot.permissionDenied}</strong></div>
          <p className="status">{scanSnapshot.currentItem ?? 'Mapping local scope…'}</p>
          <div className="button-row">
            <button className="secondary" onClick={pauseOrResumeScan}>{scanSnapshot.paused ? 'Resume' : 'Pause'}</button>
            <button className="secondary" onClick={cancelScan}>Cancel</button>
          </div>
        </>}

        {scanSnapshot?.phase === 'awaiting_full_confirmation' && scanSnapshot.quickPlan && <>
          <div className="trust">
            <div><strong>{scanSnapshot.quickPlan.filesSeen.toLocaleString()}</strong><span>files mapped</span></div>
            <div><strong>{formatBytes(scanSnapshot.quickPlan.bytesSeen)}</strong><span>reachable data</span></div>
            <div><strong>{scanSnapshot.quickPlan.estimatedFullLabel}</strong><span>estimated Full Scan</span></div>
          </div>
          <p>{scanSnapshot.quickPlan.permissionDenied
            ? `${scanSnapshot.quickPlan.permissionDenied} locations could not be read with current OS permissions. CashPatch will not bypass them.`
            : 'No permission boundary was encountered in the mapped scope.'}</p>
          {scanSnapshot.quickPlan.truncated && <p className="status">Quick Scan reached its safety cap. The Full Scan estimate is conservative.</p>}
          <div className="permission-list">
            <article>
              <div>
                <b>Full Scan confirmation</b>
                <small>CashPatch will locally hash and inspect supported business files for duplicates, exposed-secret file risks and efficiency issues. It will never edit or delete anything.</small>
              </div>
              <label><input type="checkbox" checked={fullConsent} onChange={e => setFullConsent(e.target.checked)} /> I confirm the local read-only Full Scan</label>
            </article>
          </div>
          <button disabled={!fullConsent} onClick={startFullScan}>Start Full Scan</button>
        </>}

        {scanSnapshot?.phase === 'full_scanning' && <>
          <div className="status-line"><span>Progress</span><strong>{scanSnapshot.progressPercent.toFixed(1)}%</strong></div>
          <progress max="100" value={scanSnapshot.progressPercent} style={{ width: '100%' }} />
          <div className="status-line"><span>Files scanned</span><strong>{scanSnapshot.filesSeen.toLocaleString()}</strong></div>
          <div className="status-line"><span>Findings</span><strong>{scanSnapshot.findingsCount}</strong></div>
          <div className="status-line"><span>ETA</span><strong>{formatEta(scanSnapshot.etaSeconds)}</strong></div>
          <div className="status-line"><span>Elapsed</span><strong>{formatEta(scanSnapshot.elapsedSeconds)}</strong></div>
          <p className="status">{scanSnapshot.currentItem ?? 'Scanning…'}</p>
          <div className="button-row">
            <button className="secondary" onClick={pauseOrResumeScan}>{scanSnapshot.paused ? 'Resume' : 'Pause'}</button>
            <button className="secondary" onClick={cancelScan}>Cancel</button>
          </div>
        </>}

        {scanSnapshot?.phase === 'completed' && <>
          <div className="trust">
            <div><strong>{scanSnapshot.filesSeen.toLocaleString()}</strong><span>files reviewed</span></div>
            <div><strong>{scanSnapshot.findingsCount}</strong><span>findings</span></div>
            <div><strong>{formatEta(scanSnapshot.elapsedSeconds)}</strong><span>scan duration</span></div>
          </div>
          <div className="local-findings">
            {scanSnapshot.findings.map(finding => <article className="local-finding" key={finding.id}>
              <div className="local-finding-top"><span>{finding.category}</span><strong>{finding.severity}</strong></div>
              <h3>{finding.title}</h3>
              <p>{finding.summary}</p>
              <small>{finding.evidence}</small>
              <div className="local-next"><span>HOW TO FIX</span><b>{finding.remediation}</b></div>
            </article>)}
            {!scanSnapshot.findings.length && <article className="local-finding"><h3>No local findings in this pass.</h3><p>CashPatch changed nothing.</p></article>}
          </div>
        </>}
      </section>}

      {section === 'findings' && ((scanSnapshot?.findings.length ?? 0)
        ? <section className="local-findings">
            {scanSnapshot!.findings.map(finding => <article key={finding.id} className="local-finding">
              <div className="local-finding-top">
                <span>{finding.category.replaceAll('_', ' ')}</span>
                <strong>{finding.severity}</strong>
              </div>
              <h3>{finding.title}</h3>
              <p>{finding.summary}</p>
              <small>{finding.evidence}</small>
              <div className="local-next"><span>RECOMMENDED HUMAN ACTION</span><b>{finding.remediation}</b></div>
              <small>Review only · CashPatch changed nothing.</small>
            </article>)}
          </section>
        : <section className="panel empty">
            <div className="orb">0</div>
            <h2>No findings yet.</h2>
            <p>CashPatch is idle until you start a Quick Scan and confirm a Full Scan.</p>
            <button onClick={() => setSection('scan')}>Open Scan</button>
          </section>)}

      {section === 'sources' && <section className="source-grid">
        {connectedSources.map(source => <article key={source.id} className="source-card connected-source-card">
          <p className="eyebrow">{source.category}</p>
          <h3>{source.displayName ?? source.provider}</h3>
          <p>{source.status} · {source.permissionMode} · external write {source.externalWriteAllowed ? 'enabled' : 'blocked'}</p>
          <span className="ok-badge">{source.status}</span>
        </article>)}
        {cloudSources.map(source => <article key={source.name} className="source-card">
          <p className="eyebrow">{source.kind}</p>
          <h3>{source.name}</h3>
          <p>{source.detail}</p>
          <button className="secondary" onClick={() => openUrl(`${PORTAL}/dashboard/sources`)}>Connect read-only</button>
        </article>)}
        {installedApps.map(source => <article key={source.key} className="source-card">
          <p className="eyebrow">{source.kind}</p>
          <h3>{source.name}</h3>
          <p>{source.permissionHint}</p>
          <button className="secondary" onClick={() => setSection('permissions')}>Review permission</button>
        </article>)}
      </section>}

      {section === 'permissions' && <section className="panel">
        <p className="eyebrow">PERMISSION CENTER</p>
        <h2>CashPatch asks before it reads.</h2>
        <p className="muted">Each permission must be explicitly approved and remain read-only.</p>
        <div className="permission-list">
          <article>
            <div><b>Business accounts</b><small>Bank accounts, Gmail, Outlook, CRM, payments and project tools</small></div>
            <button onClick={() => openUrl(`${PORTAL}/dashboard/sources`)}>Open connection center</button>
          </article>
          <article>
            <div><b>Local folder</b><small>{approvedFolder ?? 'No folder approved'}</small></div>
            <div className="button-row">
              <button onClick={chooseFolder}>{approvedFolder ? 'Change' : 'Choose folder'}</button>
              {approvedFolder && <button className="secondary" onClick={clearFolder}>Remove access</button>}
            </div>
          </article>
          <article>
            <div><b>Installed apps</b><small>{installedApps.length ? installedApps.map(source => source.name).join(', ') : 'Nothing detected'}</small></div>
            <button onClick={refreshLocalDiscovery}>Scan again</button>
          </article>
          <article>
            <div><b>Connected business sources</b><small>{connectedSources.length ? connectedSources.map(source => source.displayName ?? source.provider).join(', ') : 'No cloud sources connected yet'}</small></div>
            <button onClick={refreshBusinessSources}>Refresh now</button>
          </article>
        </div>
      </section>}

      {section === 'ai' && <section className="panel">
        <p className="eyebrow">LOCAL AI</p>
        <h2>Analysis stays on this computer.</h2>
        <p className="muted">CashPatch never gives the local model write tools.</p>
        <div className="permission-list">
          {localAi.map(runtime => <article key={runtime.key}>
            <div><b>{runtime.name}</b><small>{runtime.endpoint}</small></div>
            <span className={runtime.available ? 'ok-badge' : 'off-badge'}>{runtime.available ? 'Ready' : 'Not detected'}</span>
          </article>)}
          {!availableAi.length && <article>
            <div><b>Need a local model?</b><small>Ollama and LM Studio are detected automatically on loopback only.</small></div>
            <div className="button-row">
              <button onClick={() => openUrl('https://ollama.com/download')}>Ollama</button>
              <button className="secondary" onClick={() => openUrl('https://lmstudio.ai/')}>LM Studio</button>
            </div>
          </article>}
          <article>
            <div><b>Jev local endpoint</b><small>Optional. CashPatch accepts only localhost/127.0.0.1/::1 endpoints and never falls back to a cloud AI.</small></div>
            <div>
              <input value={jevEndpoint} onChange={e => setJevEndpoint(e.target.value)} placeholder="http://127.0.0.1:PORT/health-or-models" />
              <div className="button-row">
                <button disabled={!jevEndpoint.trim()} onClick={() => saveLocalAiEndpoint('jev', jevEndpoint)}>Save Jev</button>
                <button className="secondary" onClick={() => clearLocalAiEndpoint('jev')}>Clear</button>
              </div>
            </div>
          </article>
          <article>
            <div><b>Other local AI endpoint</b><small>For an explicitly configured local-only runtime. Remote hosts are rejected by the native egress policy.</small></div>
            <div>
              <input value={customAiEndpoint} onChange={e => setCustomAiEndpoint(e.target.value)} placeholder="http://localhost:PORT/health-or-models" />
              <div className="button-row">
                <button disabled={!customAiEndpoint.trim()} onClick={() => saveLocalAiEndpoint('custom-local', customAiEndpoint)}>Save local AI</button>
                <button className="secondary" onClick={() => clearLocalAiEndpoint('custom-local')}>Clear</button>
              </div>
            </div>
          </article>
        </div>
        {localAiMessage && <p className="status">{localAiMessage}</p>}
      </section>}

      {section === 'vault' && <section className="panel">
        <p className="eyebrow">LOCAL ENCRYPTED VAULT</p>
        <h2>Your passwords stay on this computer.</h2>
        <p className="muted">CashPatch never scrapes browser passwords, never uploads vault contents and never uses stored credentials to log in by itself.</p>

        {!vaultStatus?.exists && <div className="permission-list">
          <article>
            <div>
              <b>Create a local vault</b>
              <small>Use a long master passphrase. CashPatch cannot recover it for you.</small>
            </div>
            <div>
              <input type="password" value={vaultMaster} onChange={e => setVaultMaster(e.target.value)} placeholder="Master passphrase · 12+ characters" autoComplete="new-password" />
              <button disabled={vaultMaster.length < 12} onClick={createVault}>Create vault</button>
            </div>
          </article>
        </div>}

        {vaultStatus?.exists && !vaultStatus.unlocked && <div className="permission-list">
          <article>
            <div>
              <b>Vault locked</b>
              <small>Argon2id key derivation · XChaCha20-Poly1305 authenticated encryption · automatic lock after {Math.round(vaultStatus.autoLockSeconds / 60)} minutes.</small>
            </div>
            <div>
              <input type="password" value={vaultMaster} onChange={e => setVaultMaster(e.target.value)} placeholder="Master passphrase" autoComplete="current-password" />
              <button onClick={unlockVault}>Unlock locally</button>
            </div>
          </article>
        </div>}

        {vaultStatus?.unlocked && <>
          <div className="button-row">
            <button className="secondary" onClick={lockVault}>Lock vault now</button>
            <button className="secondary" onClick={refreshVault}>Refresh</button>
          </div>

          <div className="permission-list">
            <article>
              <div>
                <b>Add credential</b>
                <small>Only credentials you deliberately enter are stored. No browser/session extraction.</small>
              </div>
              <div>
                <input value={vaultLabel} onChange={e => setVaultLabel(e.target.value)} placeholder="Label" />
                <input value={vaultUsername} onChange={e => setVaultUsername(e.target.value)} placeholder="Username / email" autoComplete="off" />
                <input type="password" value={vaultSecret} onChange={e => setVaultSecret(e.target.value)} placeholder="Password / secret" autoComplete="new-password" />
                <input value={vaultUrl} onChange={e => setVaultUrl(e.target.value)} placeholder="Website (optional)" />
                <input value={vaultNotes} onChange={e => setVaultNotes(e.target.value)} placeholder="Notes (optional)" />
                <button disabled={!vaultLabel.trim() || !vaultSecret} onClick={addVaultEntry}>Encrypt and save</button>
              </div>
            </article>
          </div>

          <div className="permission-list">
            {vaultEntries.map(entry => <article key={entry.id}>
              <div>
                <b>{entry.label}</b>
                <small>{entry.username || 'No username'}{entry.url ? ` · ${entry.url}` : ''}</small>
                {revealedSecret?.id === entry.id && <small>Password: {revealedSecret.value} · hidden again after 30 seconds</small>}
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => revealVaultEntry(entry.id)}>Reveal 30s</button>
                <button className="secondary" onClick={() => removeVaultEntry(entry.id)}>Remove</button>
              </div>
            </article>)}
            {!vaultEntries.length && <article><div><b>Vault empty</b><small>Add credentials manually when you want CashPatch to store them.</small></div></article>}
          </div>
        </>}

        {vaultMessage && <p className="status">{vaultMessage}</p>}
      </section>}

      {section === 'activity' && <section className="panel empty">
        <div className="orb">✓</div>
        <h2>No review activity yet.</h2>
        <p>The audit trail will record reads, syncs and analyses — never external changes.</p>
      </section>}

      {section === 'subscription' && <section className="panel">
        <p className="eyebrow">ENTITLEMENT</p>
        <h2>Subscription active.</h2>
        <p className="muted">Monitoring only runs while the server confirms a valid paid workspace.</p>
        <div className="status-line"><span>Status</span><strong>{entitlement?.billingStatus}</strong></div>
        <div className="status-line"><span>Plan</span><strong>{entitlement?.plan}</strong></div>
        <button onClick={() => openUrl(`${PORTAL}/dashboard`)}>Manage subscription</button>
      </section>}

      {section === 'settings' && <section className="panel">
        <p className="eyebrow">SETTINGS</p>
        <h2>Desktop behavior.</h2>
        <div className="permission-list">
          <article>
            <div><b>Start CashPatch with this computer</b><small>{autostart ? 'Enabled' : 'Disabled'}</small></div>
            <button className={autostart ? 'secondary' : undefined} onClick={() => setAutostartEnabled(!autostart)}>{autostart ? 'Disable' : 'Enable'}</button>
          </article>
          <article>
            <div><b>Desktop notification</b><small>Test the native alert channel.</small></div>
            <button onClick={() => notifyFinding('CashPatch alert test', 'Desktop notifications are working.')}>Test alert</button>
          </article>
          <article>
            <div><b>Updates</b><small>CashPatch checks its signed update channel at startup.</small></div>
            <button className="secondary" onClick={() => check()}>Check now</button>
          </article>
          <article>
            <div><b>Scan behavior</b><small>Manual only. CashPatch never starts a content scan in the background.</small></div>
            <button className="secondary" onClick={() => setSection('scan')}>Open Scan</button>
          </article>
        </div>
      </section>}
    </main>
  </div>
}