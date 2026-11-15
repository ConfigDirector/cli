import type { JsonObject } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";
import { readRequestFile } from "../request-file.js";
import type { KindWithAMetricOfItsOwn } from "./metric-words.js";

const EXPECTED_FORMAT: { [Kind in KindWithAMetricOfItsOwn]: string } = {
  ratio:
    'It takes a ratio as metrics get --json prints it, such as {"numerator": {"eventName": "order_completed", ' +
    '"adds": "value"}, "denominator": {"eventName": "order_completed", "adds": "events"}}.',
  funnel:
    'It takes a funnel as metrics get --json prints it, such as {"steps": [{"eventName": "cart_viewed"}, ' +
    '{"eventName": "checkout_started"}, {"eventName": "checkout_completed"}]}.',
  retention:
    'It takes a retention as metrics get --json prints it, such as {"eventName": "app_opened", "firstDay": 7, ' +
    '"lastDay": 13}.',
};

export const readDefinitionFile = (
  kind: KindWithAMetricOfItsOwn,
  argument: string,
  invocation: Invocation,
): Promise<JsonObject> => readRequestFile(`--${kind}`, argument, invocation, EXPECTED_FORMAT[kind]);
