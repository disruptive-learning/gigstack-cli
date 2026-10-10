import requests from './contracts/reset-delivery-request.schema.json'
import { approvalTeam, membershipTarget } from './account-approvals.js'
export function resetUuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw Error('Guarda un UUIDv4 en minúsculas antes de enviar')
    return value
}
export function resetInput(raw: Record<string, unknown>, recovery: boolean, mode: boolean) {
    const schema = requests[recovery ? 'prepare_recovery' : 'prepare'] as { required: string[]; properties: Record<string, {type: string; enum?: unknown[]; pattern?: string}> }
    if (Object.keys(raw).some(key => !Object.hasOwn(schema.properties, key)) || schema.required.some(key => !Object.hasOwn(raw, key))) throw Error('Entrada de restablecimiento inválida')
    for (const [key, field] of Object.entries(schema.properties)) {
        const value = raw[key]
        if (typeof value !== field.type || (field.enum && !field.enum.includes(value)) || (field.pattern && (typeof value !== 'string' || !new RegExp(field.pattern).test(value)))) throw Error('Entrada de restablecimiento inválida')
    }
    if (raw.expected_livemode !== mode || (recovery && raw.operation_id === raw.supersedes_operation_id)) throw Error('Modo o referencia de recuperación distintos')
    return raw
}
export function safeResetOperation(value: unknown, team: string, user: string, operation: string, mode: boolean, recovery: boolean, prior?: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Respuesta de restablecimiento inválida')
    const raw = value as Record<string, any>
    const fail = (): never => { throw Error('La respuesta no coincide con la operación de restablecimiento') }
    const number = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
    if (raw.operation_id !== resetUuid(operation) || raw.team_id !== approvalTeam(team) || raw.user_id !== membershipTarget(user) || raw.livemode !== mode || raw.password_change !== 'not_verified') return fail()
    const data: Record<string, unknown> = {operation_id: operation, team_id: team, user_id: user, livemode: mode, status: raw.status, password_change: 'not_verified'}
    if (recovery) {
        if (resetUuid(raw.supersedes_operation_id) === operation || (prior !== undefined && raw.supersedes_operation_id !== prior) || raw.prior_reset_code_revocation !== 'not_performed') return fail()
        data.supersedes_operation_id = raw.supersedes_operation_id
        data.prior_reset_code_revocation = 'not_performed'
        const handoff = raw.browser_handoff
        if (handoff?.effect !== 'private_review_required' || handoff.contains_reset_credential !== false || typeof handoff.url !== 'string') return fail()
        const url = new URL(handoff.url)
        if (url.username || url.password || url.hash ||
            !(['https://app.gigstack.pro','https://alphav2-staging.web.app','https://alphav2-staging.firebaseapp.com'].includes(url.origin) || (['localhost','127.0.0.1'].includes(url.hostname) && ['http:','https:'].includes(url.protocol))) ||
            url.pathname !== `/account/users/${user}/reset-recoveries/${operation}` || url.searchParams.getAll('team').length !== 1 || url.searchParams.get('team') !== team || url.searchParams.getAll('livemode').length !== 1 || url.searchParams.get('livemode') !== String(mode) || [...url.searchParams.keys()].some(key => !['team','livemode'].includes(key))) return fail()
        data.browser_handoff = {url: url.toString(), effect: 'private_review_required', contains_reset_credential: false}
    } else if (raw.supersedes_operation_id !== undefined || raw.browser_handoff !== undefined) return fail()
    if (['private_review_required','review_stale'].includes(raw.status)) {
        if (!recovery) return fail()
        for (const key of ['target_changed','acknowledge_duplicate_email_required']) if (raw[key] !== undefined) { if (typeof raw[key] !== 'boolean') return fail(); data[key] = raw[key] }
        if (raw.prior_email_delivery !== undefined) { if (!['unknown','not_attempted'].includes(raw.prior_email_delivery)) return fail(); data.prior_email_delivery = raw.prior_email_delivery }
    } else {
        if (!['prepared','outcome_unknown','generation_unknown','generated_unsent','email_unknown','provider_accepted','canceled'].includes(raw.status) || typeof raw.attempt_in_progress !== 'boolean' || raw.attempt_in_progress !== (raw.status === 'outcome_unknown') || !(raw.claim_expires_at === null || number(raw.claim_expires_at)) || (raw.attempt_in_progress && raw.claim_expires_at === null) || !number(raw.started_at) || !number(raw.updated_at) || !['not_attempted','unknown','provider_accepted'].includes(raw.email_delivery)) return fail()
        if ((raw.status === 'provider_accepted' && raw.email_delivery !== 'provider_accepted') || (!['provider_accepted','email_unknown','outcome_unknown'].includes(raw.status) && raw.email_delivery !== 'not_attempted') || (raw.status === 'email_unknown' && raw.email_delivery !== 'unknown')) return fail()
        Object.assign(data,{attempt_in_progress: raw.attempt_in_progress, claim_expires_at: raw.claim_expires_at, email_delivery: raw.email_delivery, started_at: raw.started_at, updated_at: raw.updated_at})
    }
    return data
}
export function resetUncertain(status: unknown) { return ['outcome_unknown','generation_unknown','generated_unsent','email_unknown','review_stale'].includes(String(status)) }
