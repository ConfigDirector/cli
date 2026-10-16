import { PassThrough } from "node:stream";

export const createTerminalInput = (keystrokes: string) => {
  const rawModeChanges: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (mode: boolean) => {
      rawModeChanges.push(mode);
    },
  });
  input.write(keystrokes);
  return { input, rawModeChanges };
};
