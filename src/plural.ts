export const plural = (count: number, singular: string, pluralForm: string) =>
  count === 1 ? singular : pluralForm;
