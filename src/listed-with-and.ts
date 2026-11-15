export const listedWithAnd = (items: string[]): string => {
  const lastItem = items.at(-1);
  return items.length < 2 || lastItem === undefined
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${lastItem}`;
};
