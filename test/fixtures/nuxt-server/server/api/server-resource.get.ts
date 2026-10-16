export default defineEventHandler(async (_event) => {
  const client = useConfigDirectorClient();
  return client.getValue("my-config-key", false);
});
