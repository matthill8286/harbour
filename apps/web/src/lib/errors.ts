/*
 * What people read when something fails. The api writes its own messages for the
 * mistakes it expects. Anything else, such as a browser, proxy or server fault, gets
 * one of these sentences, so no raw error text reaches the screen.
 */

export const UNREACHABLE = 'Harbour could not be reached. Check your connection and try again.';
export const SERVER_FAULT = 'Something went wrong on our side. Try again in a moment.';

/** The api's own message, or a plain one where it sent none that people should read. */
export function failureMessage(status: number, sent?: string | string[]): string {
  const message = Array.isArray(sent) ? sent.join(', ') : sent;
  // 503 is the api's deliberate "this service is not available" answer, with its own wording.
  if (status >= 500) return status === 503 && message ? message : SERVER_FAULT;
  if (message) return message;
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 403) return 'You do not have access to this.';
  if (status === 404) return 'That could not be found.';
  if (status === 413) return 'That is too large to send.';
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  return 'That did not work. Try again.';
}

/** Why the camera did not open. The scanner library reports it as a string or an error. */
export function cameraMessage(error: unknown): string {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/NotAllowed|Permission/i.test(detail)) return 'Camera access was refused. Allow the camera for this site, or type the IMEI instead.';
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(detail)) return 'No camera was found on this device. Type the IMEI instead.';
  return 'The camera could not be opened. Check that no other app is using it, or type the IMEI instead.';
}
