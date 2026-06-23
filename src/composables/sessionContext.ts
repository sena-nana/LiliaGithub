let sessionContextVersion = 0;

export function getSessionContextVersion() {
  return sessionContextVersion;
}

export function isSessionContextVersionCurrent(version: number) {
  return version === sessionContextVersion;
}

export function invalidateSessionContextSnapshot() {
  sessionContextVersion += 1;
}

export function resetSessionContextForTests() {
  sessionContextVersion = 0;
}
