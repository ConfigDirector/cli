export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  return { term: query.getValue("search-query", "") };
});
