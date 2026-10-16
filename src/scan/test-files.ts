const TEST_DIRECTORY_NAMES = new Set(["test", "tests", "__tests__", "spec", "specs", "androidtest"]);
const TEST_FILE_NAME_SUFFIXES = [".test", ".spec", "_test", "_spec"];
const TEST_CLASS_NAME_SUFFIXES = ["Test", "Tests", "Spec"];
const TEST_FILE_NAME_PREFIX = "test_";

const withoutExtension = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? fileName : fileName.slice(0, dot);
};

const isTestFileName = (fileName: string) => {
  const name = withoutExtension(fileName);
  const lowercaseName = name.toLowerCase();
  return (
    lowercaseName.startsWith(TEST_FILE_NAME_PREFIX) ||
    TEST_FILE_NAME_SUFFIXES.some((suffix) => lowercaseName.endsWith(suffix)) ||
    TEST_CLASS_NAME_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
};

export const isTestFile = (displayPath: string): boolean => {
  const segments = displayPath.split("/");
  const fileName = segments[segments.length - 1] ?? "";
  const directories = segments.slice(0, -1);
  return (
    directories.some((directory) => TEST_DIRECTORY_NAMES.has(directory.toLowerCase())) ||
    isTestFileName(fileName)
  );
};
