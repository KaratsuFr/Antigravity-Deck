// === Conversation index (hub Jetbox model) ===
// Shared loader + helpers for the project/conversation view used by both the
// sidebar (AppSidebar) and the full Conversation History view. Sources:
//   GET /api/projects       → { projects: Project[] }
//   GET /api/conversations  → { trajectorySummaries: { [id]: summary } }

import { API_BASE } from '@/lib/config';
import { authHeaders } from '@/lib/auth';

/** Marker id for conversations not attached to any project. */
export const OUTSIDE_PROJECT = 'outside-of-project';

export interface Project {
    id: string;
    name: string;
    folderUri: string;
    conversationCount: number;
}

export interface ConvRow {
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    lastModified: string;
    stepCount: number;
    status: string;
    archived: boolean;
    pinned: boolean;
    unread?: boolean;
}

/** Loosely-typed shape of one trajectory summary as returned by /api/conversations. */
interface RawWorkspaceRef {
    repository?: { computedName?: string };
    workspaceFolderAbsoluteUri?: string;
}
interface RawSummary {
    summary?: string;
    stepCount?: number;
    lastModifiedTime?: string;
    createdTime?: string;
    status?: string;
    annotations?: {
        archived?: boolean;
        pinned?: boolean;
        title?: string;
    };
    trajectoryMetadata?: { projectId?: string };
    workspaces?: RawWorkspaceRef[];
}

export const PINNED_STORAGE_KEY = 'antigravity-pinned-convs';

export function getLocalPinnedSet(): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        const raw = localStorage.getItem(PINNED_STORAGE_KEY);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw));
    } catch { return new Set(); }
}

export function setLocalPinned(id: string, pinned: boolean): Set<string> {
    const set = getLocalPinnedSet();
    if (pinned) set.add(id);
    else set.delete(id);
    try {
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch {}
    return set;
}

export async function updateConversationAnnotations(id: string, annotations: { archived?: boolean; pinned?: boolean; title?: string }) {
    if (annotations.pinned !== undefined) {
        setLocalPinned(id, annotations.pinned);
    }
    try {
        const res = await fetch(`${API_BASE}/api/conversations/${encodeURIComponent(id)}/annotations`, {
            method: 'PATCH',
            headers: {
                ...authHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(annotations),
        });
        return await res.json();
    } catch (e) {
        console.error('Failed to update annotations:', e);
        return { success: false };
    }
}

export const READ_STORAGE_KEY = 'antigravity-read-convs';
export const READ_INIT_KEY = 'antigravity-read-convs-init';

export interface ConvReadRecord {
    lastReadTime: number; // timestamp ms
    lastReadStepCount: number;
}

export function getLocalReadMap(): Record<string, ConvReadRecord> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(READ_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

export function markConversationAsRead(id: string, lastModified?: string, stepCount?: number): Record<string, ConvReadRecord> {
    if (typeof window === 'undefined' || !id) return {};
    try {
        const map = getLocalReadMap();
        const modTime = lastModified ? new Date(lastModified).getTime() : Date.now();
        const validTime = isNaN(modTime) ? Date.now() : modTime;
        map[id] = {
            lastReadTime: Math.max(Date.now(), validTime),
            lastReadStepCount: stepCount ?? (map[id]?.lastReadStepCount || 0),
        };
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(map));
        window.dispatchEvent(new CustomEvent('antigravity-read-updated', { detail: { id, read: true } }));
        return map;
    } catch { return {}; }
}

export function toggleConversationRead(id: string, currentlyUnread: boolean, lastModified?: string, stepCount?: number): void {
    if (typeof window === 'undefined' || !id) return;
    try {
        const map = getLocalReadMap();
        if (currentlyUnread) {
            const modTime = lastModified ? new Date(lastModified).getTime() : Date.now();
            const validTime = isNaN(modTime) ? Date.now() : modTime;
            map[id] = {
                lastReadTime: Math.max(Date.now(), validTime),
                lastReadStepCount: stepCount ?? 0,
            };
        } else {
            map[id] = {
                lastReadTime: 0,
                lastReadStepCount: 0,
            };
        }
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(map));
        window.dispatchEvent(new CustomEvent('antigravity-read-updated', { detail: { id, read: currentlyUnread } }));
    } catch {}
}

export function checkAndInitReadStates(summaries: Record<string, RawSummary>) {
    if (typeof window === 'undefined') return;
    try {
        const initialized = localStorage.getItem(READ_INIT_KEY);
        if (initialized) return;

        const map = getLocalReadMap();
        const now = Date.now();
        for (const [id, s] of Object.entries(summaries)) {
            const status = s.status || '';
            const isDoneOrIdle = status === 'CASCADE_RUN_STATUS_DONE' || status === 'CASCADE_RUN_STATUS_IDLE' || !status;
            if (isDoneOrIdle) {
                map[id] = {
                    lastReadTime: now,
                    lastReadStepCount: s.stepCount || 0,
                };
            }
        }
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(map));
        localStorage.setItem(READ_INIT_KEY, 'true');
    } catch {}
}

export function isConversationUnread(
    conv: { id: string; lastModified?: string; stepCount?: number; status?: string },
    readMap: Record<string, ConvReadRecord>,
    currentConvId?: string | null
): boolean {
    if (!conv || !conv.id) return false;
    if (currentConvId && conv.id === currentConvId) return false;

    const record = readMap[conv.id];
    if (!record) {
        return (conv.stepCount ?? 0) > 0;
    }

    if (conv.lastModified) {
        const modTime = new Date(conv.lastModified).getTime();
        if (!isNaN(modTime) && modTime > record.lastReadTime + 1500) {
            return true;
        }
    }

    if (typeof conv.stepCount === 'number' && conv.stepCount > record.lastReadStepCount) {
        return true;
    }

    return false;
}

/** Compact relative time, e.g. "now", "5m", "3h", "2d", "4mo", "1y". */
export function relTime(iso: string): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo`;
    return `${Math.floor(mo / 12)}y`;
}

/** Normalize a file:// URI for comparison: decode (c%3A→c:), lowercase, strip trailing slashes. */
export function normUri(uri: string): string {
    if (!uri) return '';
    try { return decodeURIComponent(uri).toLowerCase().replace(/\/+$/, ''); }
    catch { return uri.toLowerCase().replace(/\/+$/, ''); }
}

/** Last path segment of a URI, URL-decoded, trailing slashes stripped. */
export function basename(uri: string): string {
    if (!uri) return '';
    try { return decodeURIComponent(uri).replace(/\/+$/, '').split('/').pop() || ''; }
    catch { return uri.replace(/\/+$/, '').split('/').pop() || ''; }
}

/**
 * Load the full conversation index: the project list plus every conversation as
 * a flat ConvRow[] sorted by lastModified (newest first). Conversations with no
 * project resolve `projectId` to '' (grouped under "Conversations" by callers).
 */
export async function loadConversationIndex(currentConvId?: string | null): Promise<{ projects: Project[]; rows: ConvRow[] }> {
    const [pj, cv] = await Promise.all([
        fetch(`${API_BASE}/api/projects`, { headers: authHeaders() })
            .then(r => r.json()).catch(() => ({ projects: [] })),
        fetch(`${API_BASE}/api/conversations`, { headers: authHeaders() })
            .then(r => r.json()).catch(() => ({ trajectorySummaries: {} })),
    ]);

    const projects: Project[] = pj.projects || [];
    const projById = new Map(projects.map((p: Project) => [p.id, p]));
    // Folder-URI → projectId. Conversations the LS bound to a project folder but left
    // without a trajectoryMetadata.projectId (e.g. created via StartCascade with
    // workspaceUris) still group under the right project by matching the folder.
    const folderToId = new Map(
        projects.filter(p => p.folderUri).map(p => [normUri(p.folderUri), p.id])
    );
    const summaries: Record<string, RawSummary> = cv.trajectorySummaries || {};
    const localPinned = getLocalPinnedSet();

    checkAndInitReadStates(summaries);
    const readMap = getLocalReadMap();

    const rows: ConvRow[] = Object.entries(summaries).map(([id, s]) => {
        const ws: RawWorkspaceRef = (s.workspaces && s.workspaces[0]) || {};
        const wsUri = ws.workspaceFolderAbsoluteUri || '';
        let pid = s?.trajectoryMetadata?.projectId || '';
        if (!pid && wsUri) {
            const matchedId = folderToId.get(normUri(wsUri));
            if (matchedId) pid = matchedId;
        }
        const proj = projById.get(pid);
        const repoName = ws.repository?.computedName
            ? String(ws.repository.computedName).split('/').pop()
            : '';
        const projectName = proj?.name || repoName || basename(wsUri) || '';
        const isArchived = Boolean(s.annotations?.archived);
        const isPinned = Boolean(s.annotations?.pinned || localPinned.has(id));
        const lastModified = s.lastModifiedTime || s.createdTime || '';
        const stepCount = s.stepCount || 0;
        const status = s.status || '';

        const unread = isConversationUnread(
            { id, lastModified, stepCount, status },
            readMap,
            currentConvId
        );

        return {
            id,
            title: s.summary || s.annotations?.title || 'Untitled conversation',
            projectId: pid,
            projectName,
            lastModified,
            stepCount,
            status,
            archived: isArchived,
            pinned: isPinned,
            unread,
        };
    }).sort((a, b) => {
        // Pinned conversations always come first
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.lastModified).localeCompare(a.lastModified);
    });

    return { projects, rows };
}

/** Group rows into per-project buckets plus the loose ("no project") bucket. */
export function groupByProject(rows: ConvRow[]): {
    byProject: Map<string, ConvRow[]>;
    loose: ConvRow[];
} {
    const byProject = new Map<string, ConvRow[]>();
    const loose: ConvRow[] = [];
    for (const r of rows) {
        if (!r.projectId || r.projectId === OUTSIDE_PROJECT) {
            loose.push(r);
            continue;
        }
        const list = byProject.get(r.projectId);
        if (list) list.push(r);
        else byProject.set(r.projectId, [r]);
    }
    return { byProject, loose };
}
