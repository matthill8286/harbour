import type { PrismaClient } from '@prisma/client';
import {
  grantOperator,
  listOperators,
  OperatorError,
  restoreWorkspace,
  revokeOperator,
  suspendWorkspace,
} from './workspace-access';

export const USAGE = [
  'Usage:',
  '  operator grant <email>',
  '  operator revoke <email>',
  '  operator list',
  '  operator suspend <workspace-slug> --by <operator email> --reason "<why>"',
  '  operator restore <workspace-slug> --by <operator email> --reason "<why>"',
].join('\n');

/** Runs one command and says what it did. */
export async function runOperatorCommand(
  prisma: PrismaClient,
  args: string[],
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
  throw new OperatorError(USAGE);
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
