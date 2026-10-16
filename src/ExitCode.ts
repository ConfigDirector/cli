export const ExitCode = { success: 0, problemsFound: 1, couldNotRun: 2 } as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
