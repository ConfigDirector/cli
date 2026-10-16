import { createInterface } from "node:readline";
import { CliError } from "./CliError.js";
import type { Invocation } from "./Invocation.js";

type Input = Invocation["stdin"];
type TerminalInput = Input & { setRawMode: (mode: boolean) => unknown };

const Key = {
  carriageReturn: "\r",
  lineFeed: "\n",
  interrupt: "\u0003",
  delete: "\u007f",
  backspace: "\b",
} as const;

const isTerminal = (input: Input): input is TerminalInput =>
  input.isTTY === true && typeof input.setRawMode === "function";

const readLine = async (input: Input): Promise<string> => {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    return line;
  }
  return "";
};

const readLineWithoutEcho = (input: TerminalInput, output: Invocation["stderr"]): Promise<string> =>
  new Promise((resolve, reject) => {
    let typedCharacters = "";
    const endHiddenInput = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        switch (character) {
          case Key.carriageReturn:
          case Key.lineFeed:
            endHiddenInput();
            resolve(typedCharacters);
            return;
          case Key.interrupt:
            endHiddenInput();
            reject(new CliError("Login canceled."));
            return;
          case Key.delete:
          case Key.backspace:
            typedCharacters = typedCharacters.slice(0, -1);
            break;
          default:
            typedCharacters += character;
        }
      }
    };
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });

export const readPastedApiToken = async (invocation: Invocation): Promise<string> => {
  invocation.stderr.write("Paste your API token: ");
  const { stdin } = invocation;
  const pastedText = isTerminal(stdin)
    ? await readLineWithoutEcho(stdin, invocation.stderr)
    : await readLine(stdin);
  const token = pastedText.trim();
  if (token === "") {
    throw new CliError("No API token was pasted.");
  }
  return token;
};
