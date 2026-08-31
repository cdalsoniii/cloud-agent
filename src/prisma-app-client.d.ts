/**
 * Stub declaration for missing @prisma-app/client dependency used by @mastra/core
 */
declare module '@prisma-app/client' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class PrismaClient<T extends any = any> {
    constructor(options?: T);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Prisma = any;
}
