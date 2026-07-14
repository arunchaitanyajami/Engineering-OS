export interface EngineeringSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "active" | "archived";
}

const SESSION_STORAGE_KEY = "engineering-os.sessions";

const sessionSchemaVersion = 1;

interface PersistedSessions {
  readonly schemaVersion: number;
  readonly sessions: readonly EngineeringSession[];
}

const createDefaultSessions = (): PersistedSessions => ({
  schemaVersion: sessionSchemaVersion,
  sessions: []
});

export const loadSessions = (): readonly EngineeringSession[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const serializedSessions = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (!serializedSessions) {
    return [];
  }

  try {
    const parsed = JSON.parse(serializedSessions) as PersistedSessions;

    if (parsed.schemaVersion !== sessionSchemaVersion) {
      return [];
    }

    return parsed.sessions ?? [];
  } catch {
    return [];
  }
};

export const saveSessions = (
  sessions: readonly EngineeringSession[]
): readonly EngineeringSession[] => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        ...createDefaultSessions(),
        sessions
      })
    );
  }

  return sessions;
};
