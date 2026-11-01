"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { createWorkspace } from "@/lib/cascade-api"
import type { ResourceSnapshot } from "@/lib/cascade-api"
import { loadConversationIndex, groupByProject } from "@/lib/conversations"
import type { Project, ConvRow } from "@/lib/conversations"
import { cn } from "@/lib/utils"
import { useTheme } from "@/lib/theme"
import { API_BASE } from "@/lib/config"
import { authHeaders } from "@/lib/auth"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    SidebarSeparator,
    useSidebar,
} from "@/components/ui/sidebar"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Settings, User, Plug, Book, Globe, Moon, Sun, Plus, FolderPlus,
    EllipsisVertical, Activity, FolderSync, Loader2, GitBranch, Monitor,
    Workflow, Brain, History, MessageSquare, SlidersHorizontal, Check,
    Pin, Archive, ArchiveRestore, MoreHorizontal, Trash2
} from "lucide-react"

import { ConvStatusDot, ProjectGroup } from "./sidebar/project-group"
import { updateConversationAnnotations, markConversationAsRead, toggleConversationRead } from "@/lib/conversations"
import { SystemResourceSummary } from "./sidebar/system-resource-summary"

const EXPANDED_STORAGE_KEY = 'antigravity-sidebar-expanded-projects';

function getSavedExpandedMap(): Record<string, boolean> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveExpandedMap(map: Record<string, boolean>) {
    try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(map));
    } catch {}
}

interface AppSidebarProps {
    currentConvId: string | null
    conversationsVersion: number
    /** Whether Antigravity Language Server is detected by backend */
    detected: boolean
    onSelectConversation: (convId: string | null, wsName: string) => void
    /** Start a fresh conversation (no project/workspace required). */
    onNewConversation: () => void
    /** A new project folder was created — launch straight into a new chat there. */
    onProjectCreated: (name: string) => void
    /** Start a fresh conversation scoped to an existing project's folder. */
    onNewProjectConversation: (project: Project) => void
    onShowAccountInfo: () => void
    onShowSettings: () => void
    onShowLogs: () => void
    onShowSourceControl: () => void
    onShowResources: () => void
    onShowMcp: () => void
    onShowWorkflows: () => void
    onShowMemories: () => void
    onShowRepoInfo: () => void
    /** Open the full Conversation History view, optionally filtered to a project. */
    onShowHistory: (projectId?: string | null) => void
    onGoHome: () => void
    workspaceResources?: ResourceSnapshot | null
    /** Called after a conversation is deleted, with the deleted conv ID */
    onConvDeleted?: (convId: string) => void
}

const LOOSE_LIMIT = 8

export function AppSidebar({
    currentConvId,
    conversationsVersion,
    detected,
    onSelectConversation,
    onNewConversation,
    onProjectCreated,
    onNewProjectConversation,
    onShowAccountInfo,
    onShowSettings,
    onShowLogs,
    onShowSourceControl,
    onShowResources,
    onShowMcp,
    onShowWorkflows,
    onShowMemories,
    onShowRepoInfo,
    onShowHistory,
    onGoHome,
    workspaceResources,
    onConvDeleted,
}: AppSidebarProps) {
    const { isDark, toggle: toggleTheme } = useTheme()
    const { isMobile } = useSidebar()

    const [projects, setProjects] = useState<Project[]>([])
    const [byProject, setByProject] = useState<Map<string, ConvRow[]>>(new Map())
    const [loose, setLoose] = useState<ConvRow[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => getSavedExpandedMap())

    const [newName, setNewName] = useState("")
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState("")
    const [showCreateDialog, setShowCreateDialog] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<ConvRow | null>(null)
    const [looseMenuOpenId, setLooseMenuOpenId] = useState<string | null>(null)
    const looseTouchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isLooseLongPressRef = useRef(false)

    const [pinnedMenuOpenId, setPinnedMenuOpenId] = useState<string | null>(null)
    const pinnedTouchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isPinnedLongPressRef = useRef(false)

    const handlePinnedTouchStart = (convId: string) => {
        isPinnedLongPressRef.current = false;
        if (pinnedTouchTimerRef.current) clearTimeout(pinnedTouchTimerRef.current);
        pinnedTouchTimerRef.current = setTimeout(() => {
            isPinnedLongPressRef.current = true;
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try { navigator.vibrate(40); } catch {}
            }
            setPinnedMenuOpenId(convId);
        }, 450);
    };

    const handlePinnedTouchEnd = () => {
        if (pinnedTouchTimerRef.current) {
            clearTimeout(pinnedTouchTimerRef.current);
            pinnedTouchTimerRef.current = null;
        }
    };

    const handleLooseTouchStart = (convId: string) => {
        isLooseLongPressRef.current = false;
        if (looseTouchTimerRef.current) clearTimeout(looseTouchTimerRef.current);
        looseTouchTimerRef.current = setTimeout(() => {
            isLooseLongPressRef.current = true;
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try { navigator.vibrate(40); } catch {}
            }
            setLooseMenuOpenId(convId);
        }, 450);
    };

    const handleLooseTouchEnd = () => {
        if (looseTouchTimerRef.current) {
            clearTimeout(looseTouchTimerRef.current);
            looseTouchTimerRef.current = null;
        }
    };

    // Filter and sort state
    const [hideArchived, setHideArchived] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true
        const v = localStorage.getItem('antigravity-sidebar-hide-archived')
        return v !== null ? v === 'true' : true
    })
    const [maxAgeDays, setMaxAgeDays] = useState<number | 'all'>(() => {
        if (typeof window === 'undefined') return 'all'
        const v = localStorage.getItem('antigravity-sidebar-max-age')
        if (!v || v === 'all') return 'all'
        const n = parseInt(v, 10)
        return isNaN(n) ? 'all' : n
    })
    const [projectSort, setProjectSort] = useState<'recent' | 'name'>(() => {
        if (typeof window === 'undefined') return 'recent'
        const v = localStorage.getItem('antigravity-sidebar-project-sort')
        return v === 'name' ? 'name' : 'recent'
    })
    const [convSort, setConvSort] = useState<'recent' | 'name'>(() => {
        if (typeof window === 'undefined') return 'recent'
        const v = localStorage.getItem('antigravity-sidebar-conv-sort')
        return v === 'name' ? 'name' : 'recent'
    })

    const updateHideArchived = (val: boolean) => {
        setHideArchived(val)
        localStorage.setItem('antigravity-sidebar-hide-archived', String(val))
    }
    const updateMaxAgeDays = (val: number | 'all') => {
        setMaxAgeDays(val)
        localStorage.setItem('antigravity-sidebar-max-age', String(val))
    }
    const updateProjectSort = (val: 'recent' | 'name') => {
        setProjectSort(val)
        localStorage.setItem('antigravity-sidebar-project-sort', val)
    }
    const updateConvSort = (val: 'recent' | 'name') => {
        setConvSort(val)
        localStorage.setItem('antigravity-sidebar-conv-sort', val)
    }

    // User profile state
    const [userProfile, setUserProfile] = useState<{ name: string; tier: string; avatar: string | null } | null>(null)

    const hasLoadedRef = useRef(false)
    const didInitExpandRef = useRef(false)

    const nameValidationError = useMemo(() => {
        const trimmed = newName.trim()
        if (!trimmed) return ""
        if (/[/\\:*?"<>|]/.test(trimmed)) return "Invalid characters in name"
        if (trimmed.length > 100) return "Name too long (max 100)"
        const lower = trimmed.toLowerCase()
        if (projects.some((p) => p.name.toLowerCase() === lower))
            return "Project already exists"
        return ""
    }, [newName, projects])

    // Fetch user profile on mount and when connection is established
    const fetchUserProfile = useCallback(() => {
        if (!detected) {
            setUserProfile(null)
            return
        }
        fetch(`${API_BASE}/api/user/profile`, { headers: authHeaders() })
            .then(r => r.json())
            .then(d => {
                const u = d.user
                if (!u) return
                setUserProfile({
                    name: u.name || 'User',
                    tier: u.userTier?.name || u.planStatus?.planInfo?.planName || '',
                    avatar: d.profilePicture || null,
                })
            })
            .catch(() => { })
    }, [detected])

    useEffect(() => {
        fetchUserProfile()
    }, [fetchUserProfile])

    // Re-fetch profile when profile swap happens
    useEffect(() => {
        const handler = () => {
            const attempts = [5000, 8000, 12000];
            attempts.forEach(delay => setTimeout(() => fetchUserProfile(), delay));
        }
        window.addEventListener('profile-swapped', handler)
        return () => window.removeEventListener('profile-swapped', handler)
    }, [fetchUserProfile])

    const loadIndex = useCallback(async () => {
        try {
            const { projects: projs, rows } = await loadConversationIndex(currentConvId)
            const { byProject: bp, loose: lo } = groupByProject(rows)
            setProjects(projs)
            setByProject(bp)
            setLoose(lo)

            // Open projects that have pinned conversations or conversations in progress, waiting for user, or finished unread
            setExpandedMap((prev) => {
                const saved = getSavedExpandedMap()
                const next = { ...saved, ...prev }
                let changed = false

                for (const p of projs) {
                    const convs = bp.get(p.id) || []
                    const hasPinOrActivity = convs.some((c) => {
                        if (c.pinned) return true
                        if (c.status === 'CASCADE_RUN_STATUS_RUNNING') return true
                        if (c.status === 'CASCADE_RUN_STATUS_WAITING_FOR_USER') return true
                        const isDoneOrIdle = c.status === 'CASCADE_RUN_STATUS_DONE' || c.status === 'CASCADE_RUN_STATUS_IDLE' || !c.status
                        if (isDoneOrIdle && c.unread) return true
                        return false
                    })

                    if (hasPinOrActivity) {
                        if (!next[p.id]) {
                            next[p.id] = true
                            changed = true
                        }
                    } else if (next[p.id] === undefined && saved[p.id] !== undefined) {
                        next[p.id] = saved[p.id]
                    }
                }

                if (changed) {
                    saveExpandedMap(next)
                }
                return next
            })
        } catch {
            // keep previous state on transient failures
        } finally {
            setLoading(false)
        }
    }, [currentConvId])

    useEffect(() => {
        if (!hasLoadedRef.current) {
            hasLoadedRef.current = true
            loadIndex()
        }
    }, [loadIndex])

    // Refresh when backend broadcasts conversations_updated via WS
    useEffect(() => {
        if (conversationsVersion > 0) loadIndex()
    }, [conversationsVersion, loadIndex])

    // Auto mark current active conversation as read
    useEffect(() => {
        if (currentConvId) {
            markConversationAsRead(currentConvId)
        }
    }, [currentConvId])

    // Listen for manual read/unread updates from any part of the UI
    useEffect(() => {
        const handler = () => { loadIndex() }
        window.addEventListener('antigravity-read-updated', handler)
        return () => window.removeEventListener('antigravity-read-updated', handler)
    }, [loadIndex])

    const toggleProject = useCallback((projectId: string) => {
        setExpandedMap((prev) => {
            const next = { ...prev, [projectId]: !prev[projectId] }
            saveExpandedMap(next)
            return next
        })
    }, [])

    const handleConvDeleted = useCallback(
        (convId: string) => {
            // Optimistically drop from both buckets, then re-fetch for consistency.
            setByProject((prev) => {
                const next = new Map(prev)
                for (const [pid, list] of next) {
                    if (list.some((c) => c.id === convId)) {
                        next.set(pid, list.filter((c) => c.id !== convId))
                    }
                }
                return next
            })
            setLoose((prev) => prev.filter((c) => c.id !== convId))
            onConvDeleted?.(convId)
            loadIndex()
        },
        [loadIndex, onConvDeleted]
    )

    const handleCreateProject = useCallback(async () => {
        const name = newName.trim()
        if (!name || creating || nameValidationError) return
        setCreating(true)
        setCreateError("")
        try {
            const res = await createWorkspace(name, true)
            const createdName = res.workspace?.workspaceName || name
            setNewName("")
            setShowCreateDialog(false)
            await loadIndex()
            onProjectCreated(createdName)
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to create project"
            setCreateError(msg)
        } finally {
            setCreating(false)
        }
    }, [newName, creating, nameValidationError, loadIndex, onProjectCreated])

    // Filter & sort logic for projects & loose conversations
    const filteredAndSortedProjects = useMemo(() => {
        const now = Date.now()
        const ageCutoff = maxAgeDays === 'all' ? 0 : now - (maxAgeDays as number) * 86400000

        const rowsPerProject = new Map<string, ConvRow[]>()
        for (const [pid, list] of byProject.entries()) {
            const filtered = list.filter((c) => {
                if (c.id === currentConvId) return true
                if (hideArchived && c.archived) return false
                if (ageCutoff > 0 && c.lastModified) {
                    const t = new Date(c.lastModified).getTime()
                    if (!isNaN(t) && t < ageCutoff) return false
                }
                return true
            })

            filtered.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
                if (convSort === 'name') return a.title.localeCompare(b.title)
                return (b.lastModified || '').localeCompare(a.lastModified || '')
            })

            rowsPerProject.set(pid, filtered)
        }

        const pList = projects.map((p) => {
            const convs = rowsPerProject.get(p.id) || []
            const latestTime = convs.reduce((max, c) => {
                const t = c.lastModified ? new Date(c.lastModified).getTime() : 0
                return Math.max(max, isNaN(t) ? 0 : t)
            }, 0)
            return {
                project: p,
                conversations: convs,
                total: p.conversationCount || (byProject.get(p.id) || []).length,
                latestTime,
            }
        })

        if (projectSort === 'name') {
            pList.sort((a, b) => a.project.name.localeCompare(b.project.name))
        } else {
            pList.sort((a, b) => b.latestTime - a.latestTime)
        }

        return pList
    }, [projects, byProject, hideArchived, maxAgeDays, projectSort, convSort, currentConvId])

    const filteredAndSortedLoose = useMemo(() => {
        const now = Date.now()
        const ageCutoff = maxAgeDays === 'all' ? 0 : now - (maxAgeDays as number) * 86400000

        const filtered = loose.filter((c) => {
            if (c.id === currentConvId) return true
            if (hideArchived && c.archived) return false
            if (ageCutoff > 0 && c.lastModified) {
                const t = new Date(c.lastModified).getTime()
                if (!isNaN(t) && t < ageCutoff) return false
            }
            return true
        })

        filtered.sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
            if (convSort === 'name') return a.title.localeCompare(b.title)
            return (b.lastModified || '').localeCompare(a.lastModified || '')
        })

        return filtered
    }, [loose, hideArchived, maxAgeDays, convSort, currentConvId])

    const pinnedConversations = useMemo(() => {
        const list: ConvRow[] = []
        const seen = new Set<string>()

        for (const rows of byProject.values()) {
            for (const row of rows) {
                if (row.pinned && !seen.has(row.id)) {
                    if (hideArchived && row.archived) continue
                    seen.add(row.id)
                    list.push(row)
                }
            }
        }
        for (const row of loose) {
            if (row.pinned && !seen.has(row.id)) {
                if (hideArchived && row.archived) continue
                seen.add(row.id)
                list.push(row)
            }
        }

        list.sort((a, b) => {
            if (convSort === 'name') return a.title.localeCompare(b.title)
            return (b.lastModified || '').localeCompare(a.lastModified || '')
        })
        return list
    }, [byProject, loose, hideArchived, convSort])

    const handleConfirmDelete = async () => {
        if (!deleteTarget) return
        const targetId = deleteTarget.id
        setDeleteTarget(null)
        try {
            const res = await fetch(`${API_BASE}/api/cascade/${targetId}`, {
                method: 'DELETE',
                headers: authHeaders(),
            })
            if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
            handleConvDeleted(targetId)
        } catch (err) {
            console.error('Failed to delete conversation:', err)
        }
    }

    return (
        <>
            <Sidebar variant="inset">
                <SidebarHeader>
                    <button
                        onClick={onGoHome}
                        className="flex items-center gap-2 px-4 py-2 mt-2 hover:opacity-80 transition-opacity cursor-pointer"
                    >
                        <FolderSync className="h-5 w-5 text-primary" />
                        <span className="font-semibold text-lg tracking-tight">Antigravity Deck</span>
                    </button>
                </SidebarHeader>

                {/* System Resource Summary — compact CPU/RAM bars */}
                <div className="px-3 pb-1">
                    <SystemResourceSummary
                        system={workspaceResources?.system}
                        onClick={onShowResources}
                    />
                </div>

                <SidebarContent>
                    <SidebarSeparator className="mx-0" />

                    {/* Top actions: New Conversation + Conversation History */}
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <div className="px-2 pb-1">
                                <Button
                                    size="sm"
                                    onClick={onNewConversation}
                                    className="w-full h-8 text-xs gap-1.5 justify-start"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    New Conversation
                                </Button>
                            </div>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={() => onShowHistory(null)} tooltip="Conversation History" className="text-xs">
                                        <History className="shrink-0" />
                                        <span>Conversation History</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>

                    <SidebarSeparator className="mx-0" />

                    {/* Pinned conversations in header */}
                    {pinnedConversations.length > 0 && (
                        <>
                            <SidebarGroup>
                                <div className="flex items-center justify-between px-3 py-1 text-xs font-medium text-sidebar-foreground/70">
                                    <span className="flex items-center gap-1.5 text-amber-500 font-semibold">
                                        <Pin className="h-3 w-3 fill-amber-500" />
                                        Pinned
                                    </span>
                                    <span className="text-[10px] text-sidebar-foreground/40 tabular-nums">
                                        {pinnedConversations.length}
                                    </span>
                                </div>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {pinnedConversations.map((conv) => (
                                            <SidebarMenuItem
                                                key={`pinned-hdr-${conv.id}`}
                                                className="group/conv relative flex items-center select-none"
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setPinnedMenuOpenId(conv.id);
                                                }}
                                                onTouchStart={() => handlePinnedTouchStart(conv.id)}
                                                onTouchEnd={handlePinnedTouchEnd}
                                                onTouchMove={handlePinnedTouchEnd}
                                                onTouchCancel={handlePinnedTouchEnd}
                                            >
                                                <SidebarMenuButton
                                                    isActive={conv.id === currentConvId}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (isPinnedLongPressRef.current) {
                                                            isPinnedLongPressRef.current = false;
                                                            return;
                                                        }
                                                        onSelectConversation(conv.id, conv.projectName || 'unknown');
                                                    }}
                                                    tooltip={`${conv.title}${conv.projectName ? `\nProject: ${conv.projectName}` : ''}\n${conv.stepCount} steps · ${conv.status || 'idle'}${conv.archived ? ' (archived)' : ''}${conv.unread ? ' · Unread' : ''}`}
                                                    className={cn("text-xs peer pr-8 flex items-center min-w-0 flex-1", conv.archived && "opacity-50")}
                                                >
                                                    <ConvStatusDot status={conv.status} pinned={true} unread={conv.unread} />
                                                    <div className="flex flex-col min-w-0 flex-1 text-left leading-tight py-0.5">
                                                        <span className={cn(
                                                            "truncate min-w-0 flex-1",
                                                            conv.unread ? "font-medium text-foreground" : "text-sidebar-foreground/80"
                                                        )}>
                                                            {conv.title}
                                                        </span>
                                                        {conv.projectName && (
                                                            <span className="text-[10px] text-sidebar-foreground/45 truncate">
                                                                {conv.projectName}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {conv.unread && (
                                                        <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0 ml-1" />
                                                    )}
                                                </SidebarMenuButton>
                                                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/conv:opacity-100 transition-opacity">
                                                    <DropdownMenu open={pinnedMenuOpenId === conv.id} onOpenChange={(open) => setPinnedMenuOpenId(open ? conv.id : null)}>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-sidebar-foreground/50 hover:text-sidebar-foreground">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="text-xs">
                                                            <DropdownMenuItem onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleConversationRead(conv.id, Boolean(conv.unread), conv.lastModified, conv.stepCount);
                                                                loadIndex();
                                                            }}>
                                                                <Check className="h-3.5 w-3.5 mr-2 text-sky-500" />
                                                                {conv.unread ? "Mark as read" : "Mark as unread"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await updateConversationAnnotations(conv.id, { pinned: false });
                                                                loadIndex();
                                                            }}>
                                                                <Pin className="h-3.5 w-3.5 mr-2 text-amber-500" />
                                                                Unpin conversation
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await updateConversationAnnotations(conv.id, { archived: !conv.archived });
                                                                loadIndex();
                                                            }}>
                                                                {conv.archived ? <ArchiveRestore className="h-3.5 w-3.5 mr-2" /> : <Archive className="h-3.5 w-3.5 mr-2" />}
                                                                {conv.archived ? "Unarchive conversation" : "Archive conversation"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onClick={() => setDeleteTarget(conv)} className="text-destructive focus:text-destructive">
                                                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                                Delete conversation
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                            <SidebarSeparator className="mx-0" />
                        </>
                    )}

                    {/* Projects */}
                    <SidebarGroup>
                        <div className="flex items-center justify-between px-3 py-1 text-xs font-medium text-sidebar-foreground/70">
                            <span>Projects</span>
                            <div className="flex items-center gap-0.5">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            className={cn(
                                                "flex h-5 w-5 items-center justify-center rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent cursor-pointer transition-colors",
                                                (hideArchived || maxAgeDays !== 'all' || projectSort !== 'recent' || convSort !== 'recent') && "text-sky-500 hover:text-sky-400"
                                            )}
                                            title="Filter & sort conversations"
                                        >
                                            <SlidersHorizontal className="h-3 w-3" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56 text-xs">
                                        <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Filters</div>
                                        <DropdownMenuItem onClick={() => updateHideArchived(!hideArchived)}>
                                            <span className="flex-1">Hide archived</span>
                                            {hideArchived && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>

                                        <DropdownMenuSeparator />
                                        <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Age Filter</div>
                                        <DropdownMenuItem onClick={() => updateMaxAgeDays('all')}>
                                            <span className="flex-1">All time</span>
                                            {maxAgeDays === 'all' && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateMaxAgeDays(7)}>
                                            <span className="flex-1">Last 7 days</span>
                                            {maxAgeDays === 7 && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateMaxAgeDays(30)}>
                                            <span className="flex-1">Last 30 days</span>
                                            {maxAgeDays === 30 && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateMaxAgeDays(90)}>
                                            <span className="flex-1">Last 90 days</span>
                                            {maxAgeDays === 90 && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>

                                        <DropdownMenuSeparator />
                                        <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Sort Projects</div>
                                        <DropdownMenuItem onClick={() => updateProjectSort('recent')}>
                                            <span className="flex-1">Recent activity</span>
                                            {projectSort === 'recent' && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateProjectSort('name')}>
                                            <span className="flex-1">Name (A-Z)</span>
                                            {projectSort === 'name' && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>

                                        <DropdownMenuSeparator />
                                        <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Sort Conversations</div>
                                        <DropdownMenuItem onClick={() => updateConvSort('recent')}>
                                            <span className="flex-1">Recent activity</span>
                                            {convSort === 'recent' && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateConvSort('name')}>
                                            <span className="flex-1">Name (A-Z)</span>
                                            {convSort === 'name' && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <button
                                    type="button"
                                    onClick={() => setShowCreateDialog(true)}
                                    className="flex h-5 w-5 items-center justify-center rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent cursor-pointer transition-colors"
                                    title="New Project"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                        <SidebarGroupContent>
                            {loading && filteredAndSortedProjects.length === 0 && (
                                <div className="px-3 py-4 text-xs text-muted-foreground text-center">Loading...</div>
                            )}
                            {!loading && filteredAndSortedProjects.length === 0 && (
                                <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center">
                                    No projects yet. Open a folder in Antigravity, or create one with ＋.
                                </div>
                            )}
                            {filteredAndSortedProjects.map(({ project, conversations, total }) => (
                                <ProjectGroup
                                    key={project.id}
                                    name={project.name}
                                    totalCount={total}
                                    conversations={conversations}
                                    currentConvId={currentConvId}
                                    expanded={!!expandedMap[project.id]}
                                    onToggle={() => toggleProject(project.id)}
                                    onSelectConv={(convId) => onSelectConversation(convId, project.name)}
                                    onSeeAll={() => onShowHistory(project.id)}
                                    onNewConversation={() => onNewProjectConversation(project)}
                                    onDeleted={handleConvDeleted}
                                    onUpdated={loadIndex}
                                />
                            ))}
                        </SidebarGroupContent>
                    </SidebarGroup>

                    {/* Loose conversations (no project) */}
                    {filteredAndSortedLoose.length > 0 && (
                        <>
                            <SidebarSeparator className="mx-0" />
                            <SidebarGroup>
                                <SidebarGroupLabel>Conversations</SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {filteredAndSortedLoose.slice(0, LOOSE_LIMIT).map((conv) => (
                                            <SidebarMenuItem
                                                key={conv.id}
                                                className="group/conv relative flex items-center select-none"
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setLooseMenuOpenId(conv.id);
                                                }}
                                                onTouchStart={() => handleLooseTouchStart(conv.id)}
                                                onTouchEnd={handleLooseTouchEnd}
                                                onTouchMove={handleLooseTouchEnd}
                                                onTouchCancel={handleLooseTouchEnd}
                                            >
                                                <SidebarMenuButton
                                                    isActive={conv.id === currentConvId}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (isLooseLongPressRef.current) {
                                                            isLooseLongPressRef.current = false;
                                                            return;
                                                        }
                                                        onSelectConversation(conv.id, conv.projectName || 'unknown');
                                                    }}
                                                    tooltip={`${conv.title}\n${conv.stepCount} steps · ${conv.status || 'idle'}${conv.archived ? ' (archived)' : ''}${conv.unread ? ' · Unread' : ''}`}
                                                    className={cn("text-xs peer pr-8 flex items-center min-w-0 flex-1", conv.archived && "opacity-50")}
                                                >
                                                    <ConvStatusDot status={conv.status} pinned={conv.pinned} unread={conv.unread} />
                                                    <span className={cn(
                                                        "truncate min-w-0 flex-1",
                                                        conv.unread ? "font-medium text-foreground" : "text-sidebar-foreground/80"
                                                    )}>
                                                        {conv.title}
                                                    </span>
                                                    {conv.unread && (
                                                        <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0 ml-1" />
                                                    )}
                                                </SidebarMenuButton>
                                                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/conv:opacity-100 transition-opacity">
                                                    <DropdownMenu open={looseMenuOpenId === conv.id} onOpenChange={(open) => setLooseMenuOpenId(open ? conv.id : null)}>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-sidebar-foreground/50 hover:text-sidebar-foreground">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="text-xs">
                                                            <DropdownMenuItem onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleConversationRead(conv.id, Boolean(conv.unread), conv.lastModified, conv.stepCount);
                                                                loadIndex();
                                                            }}>
                                                                <Check className="h-3.5 w-3.5 mr-2 text-sky-500" />
                                                                {conv.unread ? "Mark as read" : "Mark as unread"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await updateConversationAnnotations(conv.id, { pinned: !conv.pinned });
                                                                loadIndex();
                                                            }}>
                                                                <Pin className="h-3.5 w-3.5 mr-2 text-amber-500" />
                                                                {conv.pinned ? "Unpin conversation" : "Pin conversation"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await updateConversationAnnotations(conv.id, { archived: !conv.archived });
                                                                loadIndex();
                                                            }}>
                                                                {conv.archived ? <ArchiveRestore className="h-3.5 w-3.5 mr-2" /> : <Archive className="h-3.5 w-3.5 mr-2" />}
                                                                {conv.archived ? "Unarchive conversation" : "Archive conversation"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onClick={() => setDeleteTarget(conv)} className="text-destructive focus:text-destructive">
                                                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                                Delete conversation
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </SidebarMenuItem>
                                        ))}
                                        {filteredAndSortedLoose.length > LOOSE_LIMIT && (
                                            <SidebarMenuItem>
                                                <SidebarMenuButton
                                                    onClick={() => onShowHistory(null)}
                                                    className="text-sidebar-foreground/50 text-[10px]"
                                                >
                                                    See all ({filteredAndSortedLoose.length})
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        )}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        </>
                    )}

                    {/* Tools (kept Deck features) */}
                    <SidebarSeparator className="mx-0" />
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={onShowMcp} tooltip="MCP Servers" className="text-xs">
                                        <Plug className="shrink-0" />
                                        <span>MCP Servers</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={onShowWorkflows} tooltip="Workflows" className="text-xs">
                                        <Workflow className="shrink-0" />
                                        <span>Workflows</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={onShowMemories} tooltip="Memories" className="text-xs">
                                        <Brain className="shrink-0" />
                                        <span>Memories</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={onShowRepoInfo} tooltip="Repo Info" className="text-xs">
                                        <GitBranch className="shrink-0" />
                                        <span>Repo Info</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>

                <SidebarFooter>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <SidebarMenuButton
                                        size="lg"
                                        className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                                    >
                                        <Avatar className="h-8 w-8 rounded-lg">
                                            {userProfile?.avatar && (
                                                <AvatarImage src={`data:image/png;base64,${userProfile.avatar}`} alt={userProfile.name} />
                                            )}
                                            <AvatarFallback className={cn(
                                                "rounded-lg text-xs font-semibold",
                                                detected ? "bg-indigo-500/20 text-indigo-400" : "bg-muted text-muted-foreground"
                                            )}>
                                                {userProfile?.name?.[0]?.toUpperCase() ?? (detected ? '?' : '—')}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="grid flex-1 text-left text-sm leading-tight">
                                            <span className="truncate font-medium text-xs">
                                                {userProfile?.name ?? (detected ? 'Loading...' : 'Not Connected')}
                                            </span>
                                            <span className="truncate text-[10px] text-sidebar-foreground/60">
                                                {userProfile?.tier ?? (detected ? '' : 'Open Antigravity IDE')}
                                            </span>
                                        </div>
                                        <EllipsisVertical className="ml-auto size-4" />
                                    </SidebarMenuButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    side={isMobile ? "bottom" : "right"}
                                    align="end"
                                    sideOffset={4}
                                    className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                                >
                                    <DropdownMenuItem onClick={onShowAccountInfo}>
                                        <User className="mr-2 h-4 w-4" />
                                        <span>Account & Plan</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={onShowLogs}>
                                        <Activity className="mr-2 h-4 w-4" />
                                        <span>Live Logs</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={onShowSourceControl}>
                                        <GitBranch className="mr-2 h-4 w-4" />
                                        <span>Source Control</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={onShowResources}>
                                        <Monitor className="mr-2 h-4 w-4" />
                                        <span>Resources</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={toggleTheme}>
                                        {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                                        <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled>
                                        <Book className="mr-2 h-4 w-4 text-muted-foreground" />
                                        <span className="text-muted-foreground">Knowledge (Coming Soon)</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled>
                                        <Globe className="mr-2 h-4 w-4 text-muted-foreground" />
                                        <span className="text-muted-foreground">Browser (Coming Soon)</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={onShowSettings}>
                                        <Settings className="mr-2 h-4 w-4" />
                                        <span>App Settings</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
                <SidebarRail />
            </Sidebar>

            <Dialog open={showCreateDialog} onOpenChange={(open) => {
                setShowCreateDialog(open)
                if (!open) { setNewName(""); setCreateError("") }
            }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FolderPlus className="h-5 w-5" />
                            New Project
                        </DialogTitle>
                        <DialogDescription>
                            Create a new project folder and jump straight into a conversation.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2.5">
                            <label className="text-xs font-medium text-muted-foreground">Project Name</label>
                            <Input
                                value={newName}
                                onChange={(e) => { setNewName(e.target.value); setCreateError("") }}
                                onKeyDown={(e) => e.key === "Enter" && !nameValidationError && handleCreateProject()}
                                placeholder="my-awesome-project"
                                className={cn(nameValidationError && newName.trim() && "border-destructive focus-visible:ring-destructive")}
                                disabled={creating}
                                autoFocus
                            />
                            {(nameValidationError || createError) && newName.trim() && (
                                <p className="text-xs text-destructive">{nameValidationError || createError}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Creates a folder in your workspace root directory, opens it, and starts a new chat.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowCreateDialog(false); setNewName(""); setCreateError("") }}
                            disabled={creating}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={async () => { await handleCreateProject() }}
                            disabled={creating || !newName.trim() || !!nameValidationError}
                        >
                            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                            Create Project
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete conversation</AlertDialogTitle>
                        <AlertDialogDescription>
                            Delete &ldquo;{deleteTarget?.title}&rdquo;? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={handleConfirmDelete}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
