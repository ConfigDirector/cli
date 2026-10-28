export default defineEventHandler(async (_event) => {
  const evaluation = useConfigDirectorServerClient().evaluate("new-checkout", false, { id: "user-id" });
  return { newCheckout: evaluation.value, reason: evaluation.reason };
});
