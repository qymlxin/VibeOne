export interface SessionGroupItem {
  id: string;
  workspace: string;
  lastActivityAt?: number;
  runs?: Array<{ createdAt?: number | null; finishedAt?: number | null }>;
}

export interface WorkspaceSummary {
  path: string;
  name: string;
}

/** 按工作区路径对会话进行分组 */
export function sessionGroups<TSession extends SessionGroupItem>(
  sessions: TSession[],
  workspaces: WorkspaceSummary[] = [],
): Array<{ path: string; name: string; sessions: TSession[] }> {
  const names = new Map(
    workspaces.map((workspace) => [workspace.path, workspace.name]),
  );
  const groups = new Map<
    string,
    { path: string; name: string; sessions: TSession[] }
  >();
  for (const session of sessions) {
    let group = groups.get(session.workspace);
    if (!group) {
      group = {
        path: session.workspace,
        name:
          names.get(session.workspace) ||
          session.workspace.split(/[\\/]/).filter(Boolean).at(-1) ||
          "工作区",
        sessions: [],
      };
      groups.set(session.workspace, group);
    }
    group.sessions.push(session);
  }
  return [...groups.values()];
}

/** 按最近活动时间倒序排列会话 */
export function recentSessions<TSession extends SessionGroupItem>(
  sessions: TSession[],
): TSession[] {
  const activity = (session: SessionGroupItem) =>
    Math.max(
      session.lastActivityAt ?? 0,
      ...(session.runs ?? []).map((run) =>
        Math.max(run.createdAt ?? 0, run.finishedAt ?? 0),
      ),
    );
  return [...sessions].sort(
    (a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id),
  );
}
