const COLUMN_GAP = "   ";

const widestCellOf = (rows: ReadonlyArray<readonly string[]>, column: number): number =>
  Math.max(0, ...rows.map((row) => row[column]?.length ?? 0));

export const alignedColumns = (rows: ReadonlyArray<readonly string[]>): string[] =>
  rows.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widestCellOf(rows, column))))
      .join(COLUMN_GAP),
  );
