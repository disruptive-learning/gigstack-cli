/** Read projection for historic API bodies. Credentials may predate write-time privacy rules.
 * The scalar policy follows clients/helpers/body-schema (including DIAN), services/helpers/body-schema,
 * invoices/helpers/{income,shared}/body-schema and their public io-schemas. Arbitrary descriptions,
 * identifiers, names, metadata, URLs and headers remain redacted even under legitimate field names.
 */
import policy from './api-payload-policy.json'
export type PayloadValue = null | boolean | number | string | PayloadValue[] | { [key: string]: PayloadValue }
const objects = new Set(policy.objects)
const numbers = new Set(policy.numbers)
const booleans = new Set(policy.booleans)
const known = new Set([...objects, ...numbers, ...booleans, ...Object.keys(policy.enums), ...policy.redacted])
const sensitive =
    /secret|password|token|authorization|cookie|header|credential|apikey|private|certificate|pfx|fiel|csd|key|content|xml|pdf|url|link|email|phone|tax_id|rfc|idempotency/i
const marker = (reason: string): PayloadValue => ({ $redacted: reason })
/** Same bounded policy is also used by public adapters as defense in depth. */
export function safeApiPayload(input: unknown, key = '', depth = 0, budget = { remaining: 1500 }): PayloadValue {
    if (--budget.remaining < 0 || depth > 8) return { $truncated: 'depth_or_node_limit' }
    if (key && sensitive.test(key)) return marker('sensitive_field')
    if (input === null || input === undefined) return null
    if (Array.isArray(input)) {
        const values = input.slice(0, 50).map((v) => safeApiPayload(v, key, depth + 1, budget))
        return input.length > 50 ? { $items: values, $omitted_items: input.length - 50 } : values
    }
    if (typeof input === 'object') {
        const row = input as Record<string, unknown>
        if (
            Object.keys(row).length === 1 &&
            typeof row.$redacted === 'string' &&
            ['sensitive_field', 'unstructured_field', 'value_not_allowlisted', 'unstructured_body'].includes(
                row.$redacted,
            )
        )
            return { $redacted: row.$redacted }
        if (
            Object.keys(row).length === 1 &&
            ['depth_or_node_limit', 'encoded_body_limit'].includes(String(row.$truncated))
        )
            return { $truncated: String(row.$truncated) }
        if (
            Object.keys(row).length === 2 &&
            Array.isArray(row.$items) &&
            Number.isSafeInteger(row.$omitted_items) &&
            Number(row.$omitted_items) > 0
        )
            return {
                $items: row.$items.slice(0, 50).map((v) => safeApiPayload(v, key, depth + 1, budget)),
                $omitted_items: Number(row.$omitted_items),
            }
        if (key && !objects.has(key)) return marker('unstructured_field')
        const result: { [key: string]: PayloadValue } = Object.create(null) as { [key: string]: PayloadValue }
        let omitted = 0
        const entries = Object.entries(input)
        for (const [field, value] of entries.slice(0, 100)) {
            if (
                ['$redacted_keys', '$omitted_keys'].includes(field) &&
                Number.isSafeInteger(value) &&
                Number(value) >= 0
            ) {
                result[field] = Number(value)
                continue
            }
            if (!known.has(field)) {
                omitted++
                continue
            }
            result[field] = safeApiPayload(value, field, depth + 1, budget)
        }
        if (omitted) result.$redacted_keys = omitted
        if (entries.length > 100) result.$omitted_keys = entries.length - 100
        return result
    }
    if (typeof input === 'number' && Number.isFinite(input) && numbers.has(key)) return input
    if (typeof input === 'boolean' && booleans.has(key)) return input
    const values = Object.prototype.hasOwnProperty.call(policy.enums, key)
        ? (policy.enums as Record<string, (string | number)[]>)[key]
        : undefined
    if ((typeof input === 'string' || typeof input === 'number') && values?.includes(input)) return input
    return marker('value_not_allowlisted')
}
export function readApiPayload(value: unknown): PayloadValue {
    if (typeof value === 'string') {
        if (value.length > 262144) return { $truncated: 'encoded_body_limit' }
        try {
            return safeApiPayload(JSON.parse(value))
        } catch {
            return marker('unstructured_body')
        }
    }
    return safeApiPayload(value)
}
