export const newCheckoutFor = (userId: string) =>
  useConfigDirectorClient().getValue("new-checkout", false, { id: userId });
