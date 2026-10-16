import { fitsKeyGrammar, plainStringContent } from "./literals.js";
import type { SourceCode } from "./source-code.js";

type ConstantAssignment = { name: string; key: string; tokenIndex: number };

type IndexedKey = { kind: "key"; key: string } | { kind: "ambiguous" };

const TOKENS_ENDING_AN_ASSIGNED_LITERAL = new Set([";", ",", ")", "}", "]"]);

const endsAssignedLiteral = (code: SourceCode, stringIndex: number): boolean => {
  const next = code.token(stringIndex + 1);
  return (
    next === undefined ||
    (next.kind === "punctuation" && TOKENS_ENDING_AN_ASSIGNED_LITERAL.has(next.text)) ||
    code.isIdentifier(stringIndex + 1, "as") ||
    code.startsLine(stringIndex + 1)
  );
};

const identifierAt = (code: SourceCode, index: number): string | undefined => {
  const token = code.token(index);
  return token?.kind === "identifier" ? token.text : undefined;
};

const nameAssignedAt = (code: SourceCode, equalsIndex: number): string | undefined => {
  const nameOrType = identifierAt(code, equalsIndex - 1);
  if (nameOrType !== undefined) {
    const typedName = code.isPunctuation(equalsIndex - 2, ":")
      ? identifierAt(code, equalsIndex - 3)
      : undefined;
    return typedName ?? nameOrType;
  }
  const isGoShortDeclaration =
    code.isPunctuation(equalsIndex - 1, ":") && code.characterAfter(equalsIndex - 1) === "=";
  return isGoShortDeclaration ? identifierAt(code, equalsIndex - 2) : undefined;
};

const nameHoldingLiteralAt = (code: SourceCode, stringIndex: number): string | undefined => {
  if (code.isPunctuation(stringIndex - 1, "=")) {
    return nameAssignedAt(code, stringIndex - 1);
  }
  return code.isPunctuation(stringIndex - 1, ":") ? identifierAt(code, stringIndex - 2) : undefined;
};

export const constantAssignmentsIn = (code: SourceCode): ConstantAssignment[] =>
  code.tokens.flatMap((token, index) => {
    if (token.kind !== "string" || !endsAssignedLiteral(code, index)) {
      return [];
    }
    const key = plainStringContent(code, { first: index, last: index });
    if (key === undefined || !fitsKeyGrammar(key)) {
      return [];
    }
    const name = nameHoldingLiteralAt(code, index);
    return name === undefined ? [] : [{ name, key, tokenIndex: index }];
  });

export class ConstantIndex {
  private readonly keyOfName = new Map<string, IndexedKey>();

  public add(assignment: ConstantAssignment): void {
    const indexed = this.keyOfName.get(assignment.name);
    if (indexed === undefined) {
      this.keyOfName.set(assignment.name, { kind: "key", key: assignment.key });
    } else if (indexed.kind === "key" && indexed.key !== assignment.key) {
      this.keyOfName.set(assignment.name, { kind: "ambiguous" });
    }
  }

  public keyOf(name: string): string | undefined {
    const indexed = this.keyOfName.get(name);
    return indexed?.kind === "key" ? indexed.key : undefined;
  }
}
