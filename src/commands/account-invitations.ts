import { Command } from 'commander';
import { approvalTeam, prepareApproval, prepareBillingInvitation } from '../account-approvals.js';
import { invitationId, invitationPayload, ownedInvitationRequest } from '../invitation-contract.js';
import { requireConfirmation } from '../input.js';
export function registerAccountInvitationCommands(program:Command) {
  const commands=program.command('account-invitations').description('Invitaciones aprobadas por el propietario: preparar no envía ni otorga acceso');
  for(const billing of [false,true]) {
    commands.command(billing?'prepare-billing <billingAccountId>':'prepare-team <teamId>')
      .description(billing?'Preparar administrador de toda la cuenta; sólo su propietario canónico puede aprobar':'Preparar administrador del equipo; sólo su propietario actual puede aprobar')
      .requiredOption('--operation-id <uuid>','UUIDv4 persistido; repetir sólo la misma preparación')
      .requiredOption('--email <email>','Correo destinatario')
      .option('--send-email','Solicitar un único envío después de aprobación')
      .option('--no-send-email','No solicitar envío')
      .option('--existing-invitation <id>','Recuperar invitación pendiente exacta; requiere --no-send-email')
      .action(async(id,opts,command)=>{
        if(command.getOptionValueSource('sendEmail')!=='cli') throw new Error('Elige explícitamente --send-email o --no-send-email');
        const payload=invitationPayload(opts.email,opts.sendEmail,opts.existingInvitation);
        if(billing) await prepareBillingInvitation(opts.operationId,invitationId(id),payload);
        else await prepareApproval(opts.operationId,'team.invitations.create_admin',approvalTeam(id),payload);
      });
  }
  commands.command('get <id>').description('Consultar metadatos y entrega; nunca devuelve token').action(async id=>ownedInvitationRequest('GET',id));
  commands.command('revoke <id>').description('Revocar invitación pendiente; no retira a un miembro que ya ingresó').option('-y, --yes','Confirmar revocación')
    .action(async(id,opts)=>{invitationId(id);await requireConfirmation(opts.yes,`¿Revocar la invitación ${id}?`);await ownedInvitationRequest('DELETE',id)});
  commands.command('resend <id>').description('Enviar explícitamente tras consultar estado; no se reintenta automáticamente').option('-y, --yes','Confirmar envío de correo')
    .option('--acknowledge-unconfirmed-delivery','Reconozco que un correo anterior puede haber llegado y podría duplicarse')
    .action(async(id,opts)=>{invitationId(id);await requireConfirmation(opts.yes,`¿Reenviar la invitación ${id}? Un resultado anterior desconocido puede haber enviado el correo.`);await ownedInvitationRequest('POST',id,opts.acknowledgeUnconfirmedDelivery===true)});
}
