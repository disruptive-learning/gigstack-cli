export type SessionAction = 'managed_users.issue_session' | 'managed_users.revoke_sessions'
export const isSessionAction = (action: string): action is SessionAction =>
    action === 'managed_users.issue_session' || action === 'managed_users.revoke_sessions'
export interface SessionChange {
    user_id: string
    email: string
    auth_creation_time: string
    billing_account_id: string
    teams: Array<{ id: string; role: string }>
    billing_accounts: Array<{ id: string; role: string }>
    delivery: 'browser_once' | 'none'
    session_scope: 'firebase_identity'
    prior_attempts: Array<{
        approval_id: string
        action: SessionAction
        phase: 'attempting' | 'issued' | 'revoked' | 'unknown'
        attempted_at: number
        custom_token_expires_at: number | null
    }>
}
export interface SessionExecution {
    phase: 'attempting' | 'issued' | 'revoked' | 'unknown'
    attempted_at: number
    custom_token_expires_at: number | null
    delivery: 'not_observable' | 'none'
}
export interface SessionReceipt {
    user_id: string
    approval_id: string
    action: SessionAction
    custom_token_expires_at: number | null
    session_expiration: 'not_bounded_by_custom_token'
    revocation_scope: 'refresh_tokens_only' | null
}
const bad = (): never => {
    throw new Error('Invalid session approval')
}
const obj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : bad())
const text = (v: any): string => (typeof v === 'string' && v.length > 0 ? v : bad())
const id = (v: any): string => (/^[A-Za-z0-9_-]{1,128}$/.test(text(v)) ? v : bad())
const time = (v: any): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : bad())
const phase = (v: any): SessionExecution['phase'] =>
    ['attempting', 'issued', 'revoked', 'unknown'].includes(v) ? v : bad()
const grants = (v: any) => {
    if (!Array.isArray(v)) return bad()
    const values = v.map((r: any) => ({ id: id(obj(r).id), role: text(r.role) }))
    if (new Set(values.map((r) => r.id)).size !== values.length) return bad()
    return values
}
export function sessionProjection(raw: any): {
    change: SessionChange
    execution: SessionExecution | null
    receipt: SessionReceipt | null
} {
    const c = obj(raw.managed_session_change),
        issue = raw.action === 'managed_users.issue_session'
    if (
        raw.effect_scope !== 'managed_session' ||
        raw.disclosure_version !== 'managed-session-v1' ||
        raw.requested_modes.length ||
        raw.existing_key_ids.length ||
        raw.terms !== null ||
        raw.membership_change !== null ||
        raw.invitation_change != null ||
        raw.managed_identity_change != null ||
        raw.managed_identity_execution != null ||
        c.user_id !== raw.payload.user_id ||
        Object.keys(raw.payload).join() !== 'user_id' ||
        c.billing_account_id !== raw.billing_account_id ||
        c.delivery !== (issue ? 'browser_once' : 'none') ||
        c.session_scope !== 'firebase_identity' ||
        !Array.isArray(c.prior_attempts)
    )
        return bad()
    const change: SessionChange = {
        user_id: id(c.user_id),
        email: text(c.email),
        auth_creation_time: text(c.auth_creation_time),
        billing_account_id: id(c.billing_account_id),
        teams: grants(c.teams),
        billing_accounts: grants(c.billing_accounts),
        delivery: c.delivery,
        session_scope: 'firebase_identity',
        prior_attempts: c.prior_attempts.map((a: any) => {
            if (!/^[a-f0-9]{64}$/.test(a.approval_id) || !isSessionAction(a.action)) return bad()
            return {
                approval_id: a.approval_id,
                action: a.action,
                phase: phase(a.phase),
                attempted_at: time(a.attempted_at),
                custom_token_expires_at: a.custom_token_expires_at === null ? null : time(a.custom_token_expires_at),
            }
        }),
    }
    if (!change.teams.some((t) => t.id === raw.team?.id)) return bad()
    let execution: SessionExecution | null = null
    if (raw.managed_session_execution != null) {
        const e = obj(raw.managed_session_execution)
        if (e.delivery !== (issue ? 'not_observable' : 'none') || (!issue && e.custom_token_expires_at !== null))
            return bad()
        execution = {
            phase: phase(e.phase),
            attempted_at: time(e.attempted_at),
            custom_token_expires_at: e.custom_token_expires_at === null ? null : time(e.custom_token_expires_at),
            delivery: e.delivery,
        }
    }
    let receipt: SessionReceipt | null = null
    if (raw.receipt != null) {
        const r = obj(raw.receipt.managed_session)
        if (
            raw.status !== 'completed' ||
            r.user_id !== change.user_id ||
            r.approval_id !== raw.id ||
            r.action !== raw.action ||
            r.session_expiration !== 'not_bounded_by_custom_token' ||
            r.revocation_scope !== (issue ? null : 'refresh_tokens_only') ||
            (!issue && r.custom_token_expires_at !== null) ||
            raw.receipt.keys.length ||
            raw.receipt.revoked_count !== 0 ||
            raw.receipt.membership != null ||
            raw.receipt.invitation != null ||
            raw.receipt.managed_identity != null
        )
            return bad()
        receipt = {
            user_id: r.user_id,
            approval_id: r.approval_id,
            action: r.action,
            custom_token_expires_at: issue ? time(r.custom_token_expires_at) : null,
            session_expiration: 'not_bounded_by_custom_token',
            revocation_scope: r.revocation_scope,
        }
    }
    if (
        raw.status === 'completed' &&
        (!receipt ||
            execution?.phase !== (issue ? 'issued' : 'revoked') ||
            execution.custom_token_expires_at !== receipt.custom_token_expires_at)
    )
        return bad()
    if (raw.status === 'processing' && execution?.phase !== 'attempting') return bad()
    if (raw.status === 'unknown' && execution?.phase !== 'unknown') return bad()
    if (['pending', 'cancelled', 'expired'].includes(raw.status) && execution !== null) return bad()
    if (execution && issue && execution.custom_token_expires_at === null) return bad()
    return { change, execution, receipt }
}

export function sessionNextStep(status: string): string {
  return status === 'pending'
    ? 'Open review_url for the current owner to review the full Firebase identity scope and prior attempts. Preparation issues no session and revokes nothing. Secrets go only to the first approving browser response.'
    : 'Read the recorded session outcome. No token or login link is available through CLI. Issuance does not prove delivery or exchange; the exchange deadline does not end a redeemed session. Revocation affects refresh tokens only, not outstanding custom tokens or ID-token consumers without revocation checks. Unknown outcomes remain unknown; never automatically repeat issuance or revocation.';
}
