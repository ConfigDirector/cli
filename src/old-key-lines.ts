export const oldKeyLines = (requestedKey: string, currentKey: string): string[] =>
  requestedKey === currentKey ? [] : [`${requestedKey} is an old key of ${currentKey}.`];
