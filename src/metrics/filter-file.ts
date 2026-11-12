import type { Invocation } from "../Invocation.js";
import { readRequestListFile } from "../request-file.js";

export const readFilterFile = (filterArgument: string, invocation: Invocation): Promise<unknown[]> =>
  readRequestListFile(
    "--filter",
    filterArgument,
    invocation,
    'It takes the conditions an event\'s details must match, such as [{"field": "/plan", "targetType": "text", ' +
      '"operator": "is one of", "targetValues": ["team"]}], like the filter that metrics get --json prints.',
  );
