"use client"

import { useState } from 'react'
import { Trash2, ChevronRight, FolderGit2, MessageSquare, Plus, Pin, Archive, ArchiveRestore, MoreHorizontal, Brain, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import { API_BASE } from '@/lib/config'
import { authHeaders } from '@/lib/auth'
import type { ConvRow } from '@/lib/conversations'
import { updateConversationAnnotations } from '@/lib/conversations'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const SHOW_LIMIT = 6

interface ProjectGroupProps {
    name: string
    /** Total conversation count for the "See all (N)" affordance. */
    totalCount: number
    conversations: ConvRow[]
    currentConvId: string | null
    expanded: boolean
    onToggle: () => void
    onSelectConv: (convId: string) => void
    /** Open the full History view filtered to this project. */
    onSeeAll: () => void
    /** Start a fresh conversation scoped to this project's folder. */
    onNewConversation: () => void
    onDeleted?: (convId: string) => void
    onUpdated?: () => void
}

export function ConvStatusDot({ status, pinned }: { status?: string; pinned?: boolean }) {
    if (status === 'CASCADE_RUN_STATUS_RUNNING') {
        return (
            <span className="relative flex items-center justify-center h-4 w-4 shrink-0 mr-1.5" title="Thinking / Generating...">
                <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-purple-400 opacity-60" />
                <Brain className="relative h-3.5 w-3.5 text-purple-400 animate-pulse" />
            </span>
        );
    }
    if (status === 'CASCADE_RUN_STATUS_WAITING_FOR_USER') {
        return (
            <span className="relative flex items-center justify-center h-4 w-4 shrink-0 mr-1.5" title="Waiting for user input...">
                <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 opacity-60" />
                <AlertCircle className="relative h-3.5 w-3.5 text-amber-400 animate-bounce" />
            </span>
        );
    }
    if (status === 'CASCADE_RUN_STATUS_ERROR') {
        return (
            <span className="inline-flex items-center justify-center h-4 w-4 shrink-0 mr-1.5" title="Error">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            </span>
        );
    }
    if (status === 'CASCADE_RUN_STATUS_DONE' || status === 'CASCADE_RUN_STATUS_IDLE') {
        if (pinned) {
            return (
                <span title="Pinned (Done)" className="inline-flex items-center gap-0.5 shrink-0 mr-1.5">
                    <Pin className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                    <CheckCircle2 className="h-3 w-3 text-emerald-500/80" />
                </span>
            );
        }
        return (
            <span title="Done" className="inline-flex items-center justify-center h-4 w-4 shrink-0 mr-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/80" />
            </span>
        );
    }
    if (pinned) {
        return (
            <span title="Pinned" className="inline-flex items-center justify-center h-4 w-4 shrink-0 mr-1.5">
                <Pin className="h-3 w-3 text-amber-500 fill-amber-500" />
            </span>
        );
    }
    return <MessageSquare className="h-3.5 w-3.5 shrink-0 mr-1.5 opacity-60" />;
}

export function ProjectGroup({
    name,
    totalCount,
    conversations,
    currentConvId,
    expanded,
    onToggle,
    onSelectConv,
    onSeeAll,
    onNewConversation,
    onDeleted,
    onUpdated,
}: ProjectGroupProps) {
    const [deleteTarget, setDeleteTarget] = useState<ConvRow | null>(null)

    const handleTogglePin = async (e: React.MouseEvent, conv: ConvRow) => {
        e.stopPropagation();
        await updateConversationAnnotations(conv.id, { pinned: !conv.pinned });
        onUpdated?.();
    };

    const handleToggleArchive = async (e: React.MouseEvent, conv: ConvRow) => {
        e.stopPropagation();
        await updateConversationAnnotations(conv.id, { archived: !conv.archived });
        onUpdated?.();
    };

    const visible = conversations.slice(0, SHOW_LIMIT)
    const hasMore = totalCount > visible.length

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
            onDeleted?.(targetId)
        } catch (err) {
            console.error('Failed to delete conversation:', err)
        }
    }

    return (
        <>
            <SidebarMenu>
                <SidebarMenuItem>
                    <Collapsible open={expanded} onOpenChange={onToggle} className="group/collapsible">
                        <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip={name} className="text-xs !pr-2">
                                <FolderGit2 className="shrink-0" />
                                <span className="flex-1 truncate min-w-0">{name}</span>
                                <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label="New conversation in this project"
                                    title="New conversation in this project"
                                    onClick={(e) => { e.stopPropagation(); onNewConversation(); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onNewConversation(); } }}
                                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </span>
                                <span className="text-[10px] text-sidebar-foreground/40 tabular-nums shrink-0">
                                    {totalCount}
                                </span>
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                    <ChevronRight className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                </span>
                            </SidebarMenuButton>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                            <SidebarMenuSub>
                                {conversations.length === 0 ? (
                                    <SidebarMenuSubItem>
                                        <span className="px-2 py-1 text-[10px] text-sidebar-foreground/40 italic">
                                            No conversations
                                        </span>
                                    </SidebarMenuSubItem>
                                ) : (
                                    <>
                                        {visible.map(conv => (
                                            <SidebarMenuSubItem key={conv.id} className="group/conv relative flex items-center">
                                                <SidebarMenuSubButton
                                                    isActive={conv.id === currentConvId}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        onSelectConv(conv.id);
                                                    }}
                                                    title={`${conv.title}\n${conv.stepCount} steps · ${conv.status || 'idle'}${conv.archived ? ' (archived)' : ''}`}
                                                    className={cn("text-xs peer pr-8 flex items-center min-w-0 flex-1", conv.archived && "opacity-50")}
                                                >
                                                    <ConvStatusDot status={conv.status} pinned={conv.pinned} />
                                                    <span className="truncate min-w-0 flex-1">{conv.title}</span>
                                                </SidebarMenuSubButton>
                                                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/conv:opacity-100 transition-opacity">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-sidebar-foreground/50 hover:text-sidebar-foreground">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="text-xs">
                                                            <DropdownMenuItem onClick={(e) => handleTogglePin(e, conv)}>
                                                                <Pin className="h-3.5 w-3.5 mr-2 text-amber-500" />
                                                                {conv.pinned ? "Unpin conversation" : "Pin conversation"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={(e) => handleToggleArchive(e, conv)}>
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
                                            </SidebarMenuSubItem>
                                        ))}
                                        {hasMore && (
                                            <SidebarMenuSubItem>
                                                <SidebarMenuSubButton
                                                    onClick={onSeeAll}
                                                    className="text-sidebar-foreground/50 text-[10px]"
                                                >
                                                    See all ({totalCount})
                                                </SidebarMenuSubButton>
                                            </SidebarMenuSubItem>
                                        )}
                                    </>
                                )}
                            </SidebarMenuSub>
                        </CollapsibleContent>
                    </Collapsible>
                </SidebarMenuItem>
            </SidebarMenu>

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
