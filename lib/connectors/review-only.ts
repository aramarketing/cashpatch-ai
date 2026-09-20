export const CASH_PATCH_PERMISSION_MODE = 'review_only' as const

export const FORBIDDEN_EXTERNAL_ACTIONS = [
  'write','create','update','delete','send','execute','mutate',
  'click','type','keyboard','mouse',
  'write_file','delete_file','move_file','rename_file','upload',
  'submit_form','send_email','send_message',
  'create_task','update_task','delete_task',
  'create_record','update_record','delete_record',
  'charge','refund','transfer','payout',
] as const

export type ReviewOnlyCapability =
  | 'read'
  | 'list'
  | 'search'
  | 'inspect'
  | 'download'
  | 'sync'
  | 'analyze'
  | 'token_refresh'
  | 'webhook_receive'

export function assertReviewOnlyCapabilities(capabilities: string[]) {
  const forbidden = new Set<string>(FORBIDDEN_EXTERNAL_ACTIONS)
  const match = capabilities.find((capability) => forbidden.has(capability))
  if (match) {
    throw new Error('CashPatch review-only policy blocked external capability: ' + match)
  }
}

export async function reviewOnlyFetch(
  input: string | URL | Request,
  init: RequestInit = {},
) {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(
      'CashPatch review-only policy blocked outbound HTTP method ' + method + '. ' +
      'Provider data access must be read-only. OAuth token exchange and webhook receipt must use isolated auth infrastructure.',
    )
  }

  return fetch(input, init)
}
