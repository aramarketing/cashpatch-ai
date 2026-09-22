export type ReviewCapability =
  | 'account.read'
  | 'mail.read'
  | 'calendar.read'
  | 'contacts.read'
  | 'files.read'
  | 'crm.read'
  | 'projects.read'
  | 'commerce.read'
  | 'finance.accounts.read'
  | 'finance.balances.read'
  | 'finance.transactions.read'
  | 'subscriptions.read'
  | 'ai.conversations.read'

export type ReviewConnectorCategory =
  | 'email'
  | 'calendar'
  | 'storage'
  | 'crm'
  | 'project_management'
  | 'commerce'
  | 'banking'
  | 'accounting'
  | 'ai_conversations'

export type ReviewOnlyConnectorManifest = {
  key: string
  displayName: string
  category: ReviewConnectorCategory
  capabilities: readonly ReviewCapability[]
  permissionMode: 'review_only'
  externalWriteAllowed: false
  notes?: string
}

const FORBIDDEN_CAPABILITY_FRAGMENTS = [
  'write',
  'send',
  'delete',
  'edit',
  'create',
  'update',
  'post',
  'publish',
  'payment',
  'transfer',
  'refund',
  'payout',
  'initiate',
  'execute',
  'approve',
  'move',
  'upload',
] as const

const normalize = (value: string) => value.trim().toLowerCase()

export const assertReviewOnlyCapability = (capability: string): ReviewCapability => {
  const normalized = normalize(capability)
  if (!normalized.endsWith('.read')) {
    throw new Error(`Connector capability must be read-only: ${capability}`)
  }
  if (FORBIDDEN_CAPABILITY_FRAGMENTS.some(fragment => normalized.includes(fragment))) {
    throw new Error(`Forbidden connector capability: ${capability}`)
  }
  return normalized as ReviewCapability
}

export const assertReviewOnlyManifest = (
  manifest: ReviewOnlyConnectorManifest,
): ReviewOnlyConnectorManifest => {
  if (!manifest.key.trim() || !manifest.displayName.trim()) {
    throw new Error('Connector key and display name are required')
  }
  if (manifest.permissionMode !== 'review_only') {
    throw new Error(`Connector ${manifest.key} must use review_only permission mode`)
  }
  if (manifest.externalWriteAllowed !== false) {
    throw new Error(`Connector ${manifest.key} may not enable external writes`)
  }
  if (!manifest.capabilities.length) {
    throw new Error(`Connector ${manifest.key} must declare at least one read capability`)
  }
  manifest.capabilities.forEach(assertReviewOnlyCapability)
  return manifest
}

const BUILT_IN_CONNECTORS = [
  {
    key: 'gmail',
    displayName: 'Gmail',
    category: 'email',
    capabilities: ['account.read', 'mail.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
  },
  {
    key: 'microsoft-outlook',
    displayName: 'Microsoft Outlook',
    category: 'email',
    capabilities: ['account.read', 'mail.read', 'calendar.read', 'contacts.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
  },
  {
    key: 'google-drive',
    displayName: 'Google Drive',
    category: 'storage',
    capabilities: ['account.read', 'files.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
  },
  {
    key: 'hubspot',
    displayName: 'HubSpot',
    category: 'crm',
    capabilities: ['account.read', 'crm.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
  },
  {
    key: 'clickup',
    displayName: 'ClickUp',
    category: 'project_management',
    capabilities: ['account.read', 'projects.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
  },
  {
    key: 'shopify',
    displayName: 'Shopify',
    category: 'commerce',
    capabilities: ['account.read', 'commerce.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
  },
  {
    key: 'stripe',
    displayName: 'Stripe',
    category: 'commerce',
    capabilities: ['account.read', 'commerce.read', 'subscriptions.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
    notes: 'CashPatch may inspect account and subscription metadata but may never refund, pay out or mutate Stripe data.',
  },
  {
    key: 'banking-ais',
    displayName: 'Bank accounts (AIS only)',
    category: 'banking',
    capabilities: ['finance.accounts.read', 'finance.balances.read', 'finance.transactions.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
    notes: 'Account Information only. Payment initiation, transfers, refunds and payouts are deliberately absent.',
  },
  {
    key: 'ai-conversation-export',
    displayName: 'AI conversation exports',
    category: 'ai_conversations',
    capabilities: ['ai.conversations.read'],
    permissionMode: 'review_only',
    externalWriteAllowed: false,
    notes: 'Only user-approved exports or legitimate read-only provider access. No browser-session or credential extraction.',
  },
] satisfies readonly ReviewOnlyConnectorManifest[]

export const REVIEW_ONLY_CONNECTORS: readonly ReviewOnlyConnectorManifest[] =
  BUILT_IN_CONNECTORS.map(manifest => assertReviewOnlyManifest(manifest))

export const manifestForConnector = (key: string) =>
  REVIEW_ONLY_CONNECTORS.find(manifest => manifest.key === key) ?? null
