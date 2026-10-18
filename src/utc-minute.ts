export const utcMinute = (time: string): string => {
  const isoTime = new Date(time).toISOString();
  const date = isoTime.slice(0, "yyyy-mm-dd".length);
  const hoursAndMinutes = isoTime.slice("yyyy-mm-ddT".length, "yyyy-mm-ddThh:mm".length);
  return `${date} ${hoursAndMinutes} UTC`;
};
