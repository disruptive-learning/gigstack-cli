import { Command } from 'commander'
import { api } from '../api.js'
import { credentialMode } from '../credential-mode.js'
import { approvalTeam, membershipTarget } from '../account-approvals.js'
import { printJson } from '../output.js'
import { withJsonInput, readJsonInput, requireConfirmation } from '../input.js'
import { resetUuid, resetInput, safeResetOperation, resetUncertain } from '../reset-delivery.js'
export function registerResetDeliveryCommands(program: Command) {
    const group = program.command('password-reset').description('Preparar y consultar correo de restablecimiento con UUID durable; nunca devuelve enlaces ni confirma cambio de contraseña')
    const show = (data: ReturnType<typeof safeResetOperation>) => {
        const unknown = resetUncertain(data.status)
        printJson({data, ...(unknown ? {error:{code:'reset_outcome_unconfirmed', message:'Consulta este UUID; no reenvíes automáticamente. La entrega y el cambio de contraseña no están verificados.'}} : {})})
        if (unknown) process.exitCode = 1
    }
    for (const recovery of [false,true]) {
        withJsonInput(group.command(`${recovery ? 'prepare-recovery' : 'prepare'} <userId>`).description('Guarda operation_id antes de enviar JSON. La preparación no envía correo. Recuperación exige revisión personal privada.'))
            .option('--expected-mode <mode>', 'live|test: afirmación verificada por servidor')
            .action(async (userId, opts) => {
                const team = approvalTeam(), user = membershipTarget(userId), mode = credentialMode(opts.expectedMode)
                const body = resetInput(await readJsonInput(opts), recovery, mode)
                const result = await api('POST', `/users/${user}/${recovery ? 'password-reset-recoveries' : 'password-reset-operations'}`, {team, body})
                show(safeResetOperation(result.data,team,user,resetUuid(body.operation_id),mode,recovery,body.supersedes_operation_id))
            })
    }
    for (const action of ['get','execute','cancel','get-recovery'] as const) {
        group.command(`${action} <userId> <operationId>`)
            .description(action === 'execute' ? 'Solicitar un correo para la operación preparada. No reintenta efectos; aceptación del proveedor no es entrega.' : 'Consultar estado seguro o cancelar preparación intacta; nunca recupera enlace/challenge')
            .option('--expected-mode <mode>', 'live|test: afirmación verificada por servidor')
            .option('-y, --yes', 'Confirmar ejecución explícita; sólo execute puede enviar correo')
            .action(async (userId, operationId, opts) => {
                const team = approvalTeam(), user = membershipTarget(userId), operation = resetUuid(operationId), mode = credentialMode(opts.expectedMode)
                if (action === 'execute') await requireConfirmation(opts.yes, `¿Solicitar un correo de restablecimiento para ${user} en ${team}, operación ${operation}? No se confirma entrega ni cambio de contraseña.`)
                const recovery = action === 'get-recovery'
                const path = `/users/${user}/${recovery ? 'password-reset-recoveries' : 'password-reset-operations'}/${operation}${action === 'execute' ? '/execute' : ''}`
                const result = await api(action === 'execute' ? 'POST' : action === 'cancel' ? 'DELETE' : 'GET',path,{team, ...(action === 'execute' ? {body:{}} : {})})
                show(safeResetOperation(result.data,team,user,operation,mode,recovery))
            })
    }
}
