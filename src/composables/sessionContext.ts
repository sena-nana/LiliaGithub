import { getCurrentInstance, inject, type App, type InjectionKey } from "vue";

export interface SessionContext {
  readonly revision: number;
  capture(): number;
  isCurrent(revision: number): boolean;
  invalidate(): number;
}

export const sessionContextKey: InjectionKey<SessionContext> = Symbol("lilia-github-session-context");

export function createSessionContext(initialRevision = 0): SessionContext {
  let revision = initialRevision;

  return {
    get revision() {
      return revision;
    },
    capture: () => revision,
    isCurrent: (candidate) => candidate === revision,
    invalidate: () => {
      revision += 1;
      return revision;
    },
  };
}

export function provideSessionContext(app: App, context: SessionContext) {
  app.provide(sessionContextKey, context);
  return context;
}

export function useSessionContext() {
  const context = inject(sessionContextKey, null);
  if (!context) {
    throw new Error("SessionContext is not available in the current app.");
  }
  return context;
}

export function resolveSessionContext(explicit?: SessionContext) {
  if (explicit) return explicit;
  if (!getCurrentInstance()) {
    throw new Error("SessionContext must be provided explicitly outside component setup.");
  }
  return useSessionContext();
}
