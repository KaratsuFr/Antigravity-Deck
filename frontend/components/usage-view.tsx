'use client';

import { useState, useEffect, useCallback } from 'react';
import { getQuotaSummary, formatResetCountdown, type QuotaSummary } from '@/lib/cascade-api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, RefreshCw, AlertCircle } from 'lucide-react';

export function CircularQuotaRing({
    percent,
    disabled = false,
    size = 18,
}: {
    percent: number;
    disabled?: boolean;
    size?: number;
}) {
    const strokeWidth = 2.5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.max(0, Math.min(100, percent)) / 100) * circumference;

    let color = 'stroke-emerald-500';
    if (disabled || percent <= 0) {
        color = 'stroke-zinc-600';
    } else if (percent < 25) {
        color = 'stroke-amber-500';
    }

    return (
        <svg width={size} height={size} className="shrink-0 -rotate-90">
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                className="stroke-muted-foreground/20 fill-none"
                strokeWidth={strokeWidth}
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                className={cn('fill-none transition-all duration-500', color)}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
            />
        </svg>
    );
}

export function UsageView({ onBack }: { onBack?: () => void }) {
    const [summary, setSummary] = useState<QuotaSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadQuota = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getQuotaSummary();
            if (data && data.groups) {
                setSummary(data);
            } else {
                setError('Impossible de récupérer le résumé des quotas.');
            }
        } catch (e: any) {
            setError(e.message || 'Erreur inconnue');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadQuota();
    }, [loadQuota]);

    return (
        <div className="flex-1 overflow-y-auto bg-background text-foreground">
            <div className="max-w-md mx-auto p-4 sm:p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        {onBack && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onBack}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </Button>
                        )}
                        <h2 className="text-lg font-semibold tracking-tight">Usage</h2>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadQuota}
                        disabled={loading}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        title="Actualiser"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                </div>

                {loading ? (
                    <div className="space-y-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="space-y-3">
                                <Skeleton className="h-5 w-36" />
                                <Skeleton className="h-12 w-full rounded-lg" />
                                <Skeleton className="h-12 w-full rounded-lg" />
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{error}</span>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {summary?.groups?.map((group, gi) => {
                            const weeklyBucket = group.buckets?.find(b => b.window === 'weekly');
                            const isWeeklyExhausted = weeklyBucket && (weeklyBucket.remainingFraction ?? 0) <= 0.001;

                            return (
                                <div key={gi} className="space-y-3">
                                    <h3 className="text-sm font-semibold text-foreground/90">
                                        {group.displayName}
                                    </h3>
                                    <div className="space-y-3 pl-0.5">
                                        {group.buckets?.map((bucket, bi) => {
                                            const is5h = bucket.window === '5h';
                                            const isDisabled = !!bucket.disabled || (is5h && isWeeklyExhausted);
                                            const pct = typeof bucket.remainingFraction === 'number'
                                                ? Math.round(bucket.remainingFraction * 100)
                                                : 0;
                                            const resetCountdown = formatResetCountdown(bucket.resetTime);
                                            const label = bucket.window === 'weekly' ? 'Weekly limit' : bucket.window === '5h' ? '5h limit' : bucket.displayName;

                                            return (
                                                <div
                                                    key={bi}
                                                    className={cn(
                                                        "flex items-center justify-between py-1 transition-opacity",
                                                        isDisabled ? "opacity-45" : "opacity-100"
                                                    )}
                                                >
                                                    <div className="space-y-0.5">
                                                        <div className="text-xs text-muted-foreground font-normal">
                                                            {label}
                                                        </div>
                                                        {resetCountdown && (
                                                            <div className="text-[11px] text-muted-foreground/75">
                                                                Resets in {resetCountdown}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-normal tabular-nums">
                                                            {pct}% left
                                                        </span>
                                                        <CircularQuotaRing
                                                            percent={pct}
                                                            disabled={isDisabled}
                                                            size={18}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Informational description */}
                        {summary?.description && (
                            <div className="pt-2 text-[11px] text-muted-foreground/70 leading-relaxed border-t border-border/20">
                                {summary.description}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
