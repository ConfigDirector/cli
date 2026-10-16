import { plainStringContent } from "./literals.js";
import type { SourceCode } from "./source-code.js";

type KnownKeyText = { tokenIndex: number; key: string };

export const knownKeyTextsIn = (
  code: SourceCode,
  projectKeys: ReadonlySet<string>,
  tokensReadByCalls: ReadonlySet<number>,
): KnownKeyText[] =>
  code.tokens.flatMap((token, index) => {
    if (token.kind !== "string" || tokensReadByCalls.has(index)) {
      return [];
    }
    const content = plainStringContent(code, { first: index, last: index });
    return content !== undefined && projectKeys.has(content) ? [{ tokenIndex: index, key: content }] : [];
  });
