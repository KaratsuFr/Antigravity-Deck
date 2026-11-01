// === Conversations Routes ===
// /api/workspaces/:name/conversations, /api/models, /api/conversations/*, /api/user, /api/cache

const { callApi, callApiOnInstance } = require('../api');
const { callApiBinary } = require('../api');
const { countBinarySteps, decodeBinarySteps } = require('../protobuf');
const { STEP_LOAD_CHUNK } = require('../config');
const { lsInstances } = require('../config');
const { stepCache } = require('../cache');
const { getInstanceByName } = require('../detector');
const { resolveInst } = require('./route-helpers');

// Private helper — clear all step cache
function clearCache() {
    const { cleanupAll } = require('../cleanup');
    return cleanupAll();
}

module.exports = function setupConversationsRoutes(app) {
    // Conversations for a specific workspace (filtered by workspace URI)
    app.get('/api/workspaces/:name/conversations', async (req, res) => {
        const inst = getInstanceByName(decodeURIComponent(req.params.name));
        if (!inst) return res.status(400).json({ error: 'Unknown workspace' });

        try {
            // Source: full Jetbox conversation history (all-time). Fall back to the live
            // cascade list only if Jetbox hasn't populated yet (e.g. right after boot).
            const { getSummaries } = require('../jetbox');
            let all = getSummaries();
            if (!all || Object.keys(all).length === 0) {
                const trajData = await callApiOnInstance(inst, 'GetAllCascadeTrajectories');
                all = trajData.trajectorySummaries || {};
            }

            // Filter: only keep cascades whose workspace URI matches this instance.
            // Case-insensitive + decoded comparison (Windows drive letters vary: C: vs c:).
            // Orphans (no workspace URIs) only show in detached instances (no real folder).
            const wsUri = inst.workspaceFolderUri;
            const isDetached = !wsUri || wsUri.startsWith('detached://');
            const normalize = uri => decodeURIComponent(uri || '').toLowerCase().replace(/\/+$/, '');
            const wsUriNorm = normalize(wsUri);
            const filtered = {};
            for (const [id, info] of Object.entries(all)) {
                const cascadeWsUris = (info.workspaces || []).map(w => w.workspaceFolderAbsoluteUri);
                const isOrphan = !info.workspaces || info.workspaces.length === 0;
                const matchesWorkspace = cascadeWsUris.some(uri => normalize(uri) === wsUriNorm);
                if (matchesWorkspace || (isOrphan && isDetached)) filtered[id] = info;
            }

            res.json({ trajectorySummaries: filtered });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Available models for cascade — mirrors the Antigravity IDE's model picker:
    // same models, same order + grouping (from clientModelSorts), same badges (tagTitle).
    // The LS already scopes clientModelConfigs to the signed-in user's tier, so no extra
    // tier filtering is needed here; we only drop any explicitly-disabled model defensively.
    app.get('/api/models', async (req, res) => {
        try {
            // Models are hub-global in 2.0.11; resolveInst() already falls back to the
            // shared hub (getFirstActiveInstance) when no workspace is tracked, so the
            // picker still loads before a folder is opened.
            const inst = resolveInst(req);
            if (!inst) return res.status(503).json({ error: 'IDE not connected' });

            const [data, quotaSummaryRes] = await Promise.all([
                callApi('GetCascadeModelConfigData', {}, inst),
                callApi('RetrieveUserQuotaSummary', {}, inst).catch(() => null),
            ]);

            const quotaGroups = quotaSummaryRes?.response?.groups || [];

            function findModelQuota(label, modelId) {
                const lower = `${label} ${modelId}`.toLowerCase();
                let group = null;
                if (lower.includes('argon')) {
                    group = quotaGroups.find(g => g.displayName?.toLowerCase().includes('argon'));
                } else if (lower.includes('claude') || lower.includes('gpt') || lower.includes('openai')) {
                    group = quotaGroups.find(g => g.displayName?.toLowerCase().includes('claude'));
                } else if (lower.includes('gemini') || lower.includes('flash')) {
                    group = quotaGroups.find(g => g.displayName?.toLowerCase().includes('gemini models'));
                }
                if (!group) return null;
                const weekly = group.buckets?.find(b => b.window === 'weekly');
                const fiveH = group.buckets?.find(b => b.window === '5h');
                return {
                    groupName: group.displayName,
                    weekly: weekly ? {
                        remainingFraction: typeof weekly.remainingFraction === 'number' ? weekly.remainingFraction : 0,
                        resetTime: weekly.resetTime || null,
                        description: weekly.description || '',
                    } : null,
                    fiveHour: fiveH ? {
                        remainingFraction: typeof fiveH.remainingFraction === 'number' ? fiveH.remainingFraction : 1,
                        resetTime: fiveH.resetTime || null,
                        disabled: !!fiveH.disabled,
                        description: fiveH.description || '',
                    } : null,
                };
            }

            const mapModel = (m) => {
                const label = m.label;
                const modelId = m.modelOrAlias?.model || m.modelOrAlias?.alias || '';
                const quotaDetails = findModelQuota(label, modelId);

                // Real quota calculation from official RetrieveUserQuotaSummary:
                // If weekly quota is exhausted (0), effective quota is 0!
                let effectiveQuota = 1;
                let effectiveReset = null;

                if (quotaDetails?.weekly && quotaDetails.weekly.remainingFraction <= 0.001) {
                    effectiveQuota = 0;
                    effectiveReset = quotaDetails.weekly.resetTime;
                } else if (quotaDetails?.fiveHour && !quotaDetails.fiveHour.disabled) {
                    effectiveQuota = quotaDetails.fiveHour.remainingFraction;
                    effectiveReset = quotaDetails.fiveHour.resetTime;
                } else if (quotaDetails?.weekly) {
                    effectiveQuota = quotaDetails.weekly.remainingFraction;
                    effectiveReset = quotaDetails.weekly.resetTime;
                } else if (m.quotaInfo?.resetTime && m.quotaInfo?.remainingFraction === undefined) {
                    effectiveQuota = 0;
                    effectiveReset = m.quotaInfo.resetTime;
                } else if (m.quotaInfo?.remainingFraction !== undefined) {
                    effectiveQuota = m.quotaInfo.remainingFraction;
                    effectiveReset = m.quotaInfo.resetTime || null;
                }

                return {
                    label,
                    modelId,
                    supportsImages: !!m.supportsImages,
                    isRecommended: !!m.isRecommended,
                    isBeta: !!m.isBeta,
                    tagTitle: m.tagTitle || '',
                    tagDescription: m.tagDescription || '',
                    quota: effectiveQuota,
                    resetTime: effectiveReset,
                    quotaDetails: quotaDetails || null,
                };
            };

            // LS omits `disabled` when false; drop only models explicitly disabled.
            const configs = (data.clientModelConfigs || []).filter(m => m.disabled !== true);
            const byLabel = new Map(configs.map(m => [m.label, m]));

            // Build IDE-faithful groups from the default sort scheme (clientModelSorts[0]).
            // Its groups reference models by label and define the display order + grouping.
            const used = new Set();
            const groups = [];
            const primarySort = (data.clientModelSorts || [])[0];
            if (primarySort) {
                for (const g of (primarySort.groups || [])) {
                    const groupModels = (g.modelLabels || [])
                        .map(label => byLabel.get(label))
                        .filter(Boolean)
                        .map(m => { used.add(m.label); return mapModel(m); });
                    // Only the first group carries the sort name as its header (avoids dupes).
                    if (groupModels.length) groups.push({ name: groups.length === 0 ? (primarySort.name || '') : '', models: groupModels });
                }
            }
            // Any models the sort didn't reference stay visible (never silently hide them).
            const leftovers = configs.filter(m => !used.has(m.label)).map(mapModel);
            if (leftovers.length) groups.push({ name: groups.length ? 'Other' : '', models: leftovers });

            // Flat list (backward compatible) = groups flattened, already in IDE order.
            const models = groups.flatMap(g => g.models);
            const defaultModel = data.defaultOverrideModelConfig?.modelOrAlias?.model || '';
            res.json({ models, groups, defaultModel, quotaSummary: quotaSummaryRes?.response || null });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Official user quota summary (Gemini Models, Claude and GPT models, Gemini 4 Argon)
    app.get('/api/user/quota-summary', async (req, res) => {
        try {
            const inst = resolveInst(req);
            const data = await callApi('RetrieveUserQuotaSummary', {}, inst);
            res.json(data.response || {});
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Full conversation history — from the Jetbox stream (all projects, all-time).
    app.get('/api/conversations', async (req, res) => {
        try {
            const { getSummaries } = require('../jetbox');
            const summaries = getSummaries();
            if (summaries && Object.keys(summaries).length > 0) {
                return res.json({ trajectorySummaries: summaries });
            }
            // Fallback (Jetbox not populated yet): merge live cascade lists per unique hub conn.
            const { lsInstances } = require('../config');
            const merged = { trajectorySummaries: {} };
            const seenConns = new Set();
            for (const inst of lsInstances) {
                const connKey = `${inst.useTls ? 's' : ''}${inst.port}:${inst.csrfToken}`;
                if (seenConns.has(connKey)) continue;
                seenConns.add(connKey);
                try {
                    const data = await callApiOnInstance(inst, 'GetAllCascadeTrajectories');
                    if (data?.trajectorySummaries) Object.assign(merged.trajectorySummaries, data.trajectorySummaries);
                } catch { }
            }
            res.json(merged);
        }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Projects (Jetbox ProjectUpdatesStream + ReadProject) with conversation counts —
    // powers the "Projects" grouping in the conversation history view.
    app.get('/api/projects', (req, res) => {
        try {
            const { getProjects } = require('../jetbox');
            res.json({ projects: getProjects() });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Conversation steps
    app.get('/api/conversations/:id/steps', async (req, res) => {
        try {
            const inst = resolveInst(req);
            res.json(await callApi('GetCascadeTrajectorySteps', {
                cascadeId: req.params.id,
                startIndex: parseInt(req.query.start) || 0,
                endIndex: parseInt(req.query.end) || 999999
            }, inst));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Update conversation annotations (archive, pin, title)
    app.patch('/api/conversations/:id/annotations', async (req, res) => {
        try {
            const inst = resolveInst(req);
            const cascadeId = req.params.id;
            const annotations = req.body || {};
            const result = await callApi('UpdateConversationAnnotations', {
                cascadeId,
                annotations
            }, inst);
            const { broadcastAll } = require('../ws');
            broadcastAll({ type: 'conversations_updated' });
            res.json({ success: true, result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Load older steps for scroll-up pagination (binary protobuf for reliability)
    app.get('/api/conversations/:id/steps/older', async (req, res) => {
        try {
            const { STEP_LOAD_CHUNK } = require('../config');
            const cascadeId = req.params.id;
            const cache = stepCache[cascadeId];
            if (!cache || (cache.baseIndex || 0) === 0) {
                return res.json({ steps: [], baseIndex: 0, hasMore: false });
            }

            const currentBase = cache.baseIndex || 0;
            const loadFrom = Math.max(0, currentBase - STEP_LOAD_CHUNK);
            const loadTo = currentBase;

            // Use binary protobuf for reliable pagination
            const inst = resolveInst(req);
            const binBuf = await callApiBinary(cascadeId, loadFrom, loadTo, inst);
            const binCount = countBinarySteps(binBuf);
            let olderSteps = [];
            if (binCount > 0) {
                olderSteps = decodeBinarySteps(binBuf);
            }

            // Prepend to cache (allow temporary expansion, next poll trim will restore)
            if (olderSteps.length > 0) {
                cache.steps.unshift(...olderSteps);
                cache.baseIndex = loadFrom;
            }

            res.json({
                steps: olderSteps,
                baseIndex: loadFrom,
                hasMore: loadFrom > 0,
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // User info
    app.get('/api/user', async (req, res) => {
        try { res.json(await callApi('GetUserStatus', {}, resolveInst(req))); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Cache management
    app.delete('/api/cache', (req, res) => {
        const count = clearCache();
        console.log(`[*] Cache cleared (${count} conversations)`);
        res.json({ cleared: count });
    });

    app.delete('/api/cache/:id', (req, res) => {
        const id = req.params.id;
        if (stepCache[id]) {
            const { cleanupCascade } = require('../cleanup');
            cleanupCascade(id);
            console.log(`[*] Cache cleared for ${id.substring(0, 8)}`);
            res.json({ cleared: true, id });
        } else {
            res.json({ cleared: false, id, message: 'not cached' });
        }
    });
};
