import { dirname } from "node:path";

export class NearestDeclarations<T> {
  private readonly declarationOfDirectory = new Map<string, Promise<T | undefined>>();

  constructor(
    private readonly highestDirectory: string,
    private readonly declaredIn: (directory: string) => Promise<T | undefined>,
  ) {}

  public declarationAbove(file: string): Promise<T | undefined> {
    return this.declarationFrom(dirname(file));
  }

  private declarationFrom(directory: string): Promise<T | undefined> {
    const declarationLookedUpBefore = this.declarationOfDirectory.get(directory);
    if (declarationLookedUpBefore !== undefined) {
      return declarationLookedUpBefore;
    }
    const parent = dirname(directory);
    const isLastSearched = directory === this.highestDirectory || parent === directory;
    const declaration = this.declaredIn(directory).then(
      (declarationHere) => declarationHere ?? (isLastSearched ? undefined : this.declarationFrom(parent)),
    );
    this.declarationOfDirectory.set(directory, declaration);
    return declaration;
  }
}
