import contracts from './history-response.schema.json'
type Row = Record<string, unknown>
type Schema = {
    type?: string | string[]
    enum?: unknown[]
    const?: unknown
    properties?: Record<string, Schema>
    required?: string[]
    items?: Schema
    anyOf?: Schema[]
    oneOf?: Schema[]
    additionalProperties?: boolean | Schema
    pattern?: string
    minimum?: number
    maximum?: number
}
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const failContract = (): never => {
    throw new Error('Historical document public contract mismatch')
}
const json = (value: unknown): unknown => {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    )
        return value
    if (Array.isArray(value)) return value.map(json)
    if (!object(value)) return failContract()
    const result: Row = {}
    for (const [key, field] of Object.entries(value)) {
        Object.defineProperty(result, key, { value: json(field), enumerable: true, configurable: true, writable: true })
    }
    return result
}
/** The canonical public schema is an allowlist; only documented metadata fields allow arbitrary JSON. */
export function projectHistoricalContract(value: unknown, schema: Schema): unknown {
    const variants = schema.anyOf ?? schema.oneOf
    if (variants) {
        for (const variant of variants) {
            try {
                return projectHistoricalContract(value, variant)
            } catch {
                /* Try another documented shape. */
            }
        }
        return failContract()
    }
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    if (!types.includes(type) && !(type === 'number' && types.includes('integer') && Number.isSafeInteger(value)))
        return failContract()
    if (schema.enum && !schema.enum.includes(value)) return failContract()
    if (schema.const !== undefined && schema.const !== value) return failContract()
    if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return failContract()
    if (
        typeof value === 'number' &&
        (!Number.isFinite(value) ||
            (schema.minimum !== undefined && value < schema.minimum) ||
            (schema.maximum !== undefined && value > schema.maximum))
    )
        return failContract()
    if (value === null) return null
    if (Array.isArray(value))
        return value.map((item) => projectHistoricalContract(item, schema.items ?? failContract()))
    if (object(value)) {
        if (schema.required?.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return failContract()
        const result: Row = {}
        for (const [key, field] of Object.entries(value)) {
            const child =
                schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)
                    ? schema.properties[key]
                    : undefined
            if (child) Object.defineProperty(result,key,{value:projectHistoricalContract(field,child),enumerable:true,configurable:true,writable:true})
            else if (schema.additionalProperties === true) Object.defineProperty(result,key,{value:json(field),enumerable:true,configurable:true,writable:true})
            else if (object(schema.additionalProperties))
                Object.defineProperty(result,key,{value:projectHistoricalContract(field,schema.additionalProperties),enumerable:true,configurable:true,writable:true})
        }
        return result
    }
    return value
}
export function publicHistoricalDocument(value: unknown, kind: 'invoices' | 'receipts') {
    return projectHistoricalContract(
        value,
        (kind === 'invoices' ? contracts.invoiceDocument : contracts.receiptDocument) as Schema,
    ) as Row
}
