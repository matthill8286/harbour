import type { PrismaClient } from '@prisma/client';
import {
  grantOperator,
  listOperators,
  OperatorError,
  restoreWorkspace,
  revokeOperator,
  suspendWorkspace,
} from './workspace-access';
import {
  cancelClosure,
  deleteClosedWorkspace,
  deletionNoticeDays,
  parseContractEnd,
  scheduleClosure,
  type WorkspaceDeletionDeps,
} from './workspace-closure';

export const USAGE = [
  'Usage:',
  '  operator grant <email>',
  '  operator revoke <email>',
  '  operator list',
  '  operator suspend <workspace-slug> --by <operator email> --reason "<why>"',
  '  operator restore <workspace-slug> --by <operator email> --reason "<why>"',
  '  operator close <workspace-slug> --by <operator email> --contract-end <YYYY-MM-DD> --reason "<why>"',
  '  operator cancel-close <workspace-slug> --by <operator email> --reason "<why>"',
  '  operator delete-closed <workspace-slug> --by <operator email> [--confirm]',
].join('\n');

/** Runs one command and says what it did. */
export async function runOperatorCommand(
  prisma: PrismaClient,
  args: string[],
  deps?: WorkspaceDeletionDeps,
): Promise<string> {
  const [command, target, ...rest] = args;
  if (command === 'list' && !target) {
    const operators = await listOperators(prisma);
    return operators.length
      ? operators
          .map(
            (item) =>
              `${item.email} since ${item.since.toISOString()}${
                item.twoFactorEnabled ? '' : ' (two-factor is off)'
              }`,
          )
          .join('\n')
      : 'There are no platform operators.';
  }
  if (!target) throw new OperatorError(USAGE);
  if (command === 'grant' && rest.length === 0) {
    const { added } = await grantOperator(prisma, target);
    return added
      ? 'The account is now a platform operator.'
      : 'The account was already a platform operator.';
  }
  if (command === 'revoke' && rest.length === 0) {
    await revokeOperator(prisma, target);
    return 'The account is no longer a platform operator.';
  }
  if (command === 'suspend' || command === 'restore') {
    const change = { slug: target, ...flags(rest) };
    const act = command === 'suspend' ? suspendWorkspace : restoreWorkspace;
    const organisation = await act(prisma, change);
    return `${organisation.slug} is ${command === 'suspend' ? 'suspended' : 'restored'}.`;
  }
  if (command === 'close') {
    const values = named(rest, ['--by', '--contract-end', '--reason']);
    const { deleteAfter } = await scheduleClosure(prisma, {
      slug: target,
      operatorEmail: values.get('--by')!,
      reason: values.get('--reason')!,
      contractEndsAt: parseContractEnd(values.get('--contract-end')!),
      noticeDays: deletionNoticeDays(),
    });
    return `${target} keeps working, and its data can be deleted after ${deleteAfter.toISOString()}. Tell its Admins to export it before then.`;
  }
  if (command === 'cancel-close') {
    const values = named(rest, ['--by', '--reason']);
    await cancelClosure(prisma, {
      slug: target,
      operatorEmail: values.get('--by')!,
      reason: values.get('--reason')!,
    });
    return `${target} is no longer due for deletion.`;
  }
  if (command === 'delete-closed') {
    const confirm = rest[rest.length - 1] === '--confirm';
    const values = named(confirm ? rest.slice(0, -1) : rest, ['--by']);
    if (!deps) throw new OperatorError('Deletion is not available here.');
    const result = await deleteClosedWorkspace(prisma, deps, {
      slug: target,
      operatorEmail: values.get('--by')!,
      confirm,
    });
    const counts = Object.entries(result.summary)
      .map(([name, count]) => `${count} ${name}`)
      .join(', ');
    return result.deleted
      ? `${target} and all its data are deleted: ${counts}.`
      : `Deleting ${target} would remove ${counts}, and all its files. Nothing was changed. Add --confirm to delete it.`;
  }
  throw new OperatorError(USAGE);
}

/** Exactly these flags, each with a value. */
function named(args: string[], names: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index], args[index + 1] ?? '');
  }
  if (values.size !== names.length || names.some((name) => !values.get(name))) {
    throw new OperatorError(USAGE);
  }
  return values;
}

function flags(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index], args[index + 1] ?? '');
  }
  const operatorEmail = values.get('--by');
  const reason = values.get('--reason');
  if (!operatorEmail || reason === undefined || values.size !== 2) {
    throw new OperatorError(USAGE);
  }
  return { operatorEmail, reason };
}
