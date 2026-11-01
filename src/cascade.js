// === Cascade Submit: StartCascade + SendUserCascadeMessage ===
// Programmatically submit user input to Antigravity IDE
const { callApi, callApiStream } = require('./api');

// Helper to normalize file URIs for comparison
function normUri(uri) {
    if (!uri) return '';
    return uri.replace(/\/+$/, '');
}

// Helper to find Jetbox project matching a workspace URI or project name/id
function findMatchingProject(uriOrName) {
    if (!uriOrName) return null;
    try {
        const { getProjects } = require('./jetbox');
        const projects = getProjects() || [];
        const norm = normUri(uriOrName);
        return projects.find(p =>
            (p.folderUri && normUri(p.folderUri) === norm) ||
            p.id === uriOrName ||
            p.name === uriOrName
        ) || null;
    } catch {
        return null;
    }
}

// Create a new Cascade conversation
// inst: optional LS instance to route to (default: global lsConfig)
// Antigravity 2.0.11+ REQUIRES a trajectory `source` — an empty {} body now
// returns 400 "CortexTrajectorySource is unspecified". Since 2.0.11 uses a single
// shared hub LS, the new cascade must be bound to a workspace via `workspaceUris`
// AND `projectEnvConfig.projectId` so it properly attaches to the project in
// both Antigravity Web / CLI (`conversation_summaries.db`) and Antigravity Deck.
async function startCascade(inst = null, opts = {}) {
    const {
        source = 'CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT',
        trajectoryType = 'CORTEX_TRAJECTORY_TYPE_CASCADE',
    } = opts;
    const body = { source, trajectoryType };

    // Prefer explicit opts.workspaceUris, else derive from the routed instance
    let workspaceUris = opts.workspaceUris;
    if (!workspaceUris && inst && inst.workspaceFolderUri && inst.workspaceFolderUri.startsWith('file:')) {
        workspaceUris = [inst.workspaceFolderUri];
    }
    if (workspaceUris && workspaceUris.length) body.workspaceUris = workspaceUris;
    else if (inst && inst.isHub) console.warn('[Cascade] StartCascade with no workspace binding — conversation will be unscoped (detached)');

    // Resolve projectId for projectEnvConfig if not explicitly provided
    let projectId = opts.projectId;
    if (!projectId && workspaceUris && workspaceUris.length) {
        const matched = findMatchingProject(workspaceUris[0]);
        if (matched && matched.id) projectId = matched.id;
    }
    if (!projectId && opts.workspace) {
        const matched = findMatchingProject(opts.workspace);
        if (matched && matched.id) projectId = matched.id;
    }
    if (projectId) {
        body.projectEnvConfig = { projectId };
    }

    const result = await callApi('StartCascade', body, inst);
    return result.cascadeId;
}

// Send a user message to an existing Cascade conversation
// This is a server-streaming RPC — the connection stays open while the AI generates its response.
// options.media = array of { mimeType, inlineData, uri, thumbnail } (from SaveMediaAsArtifact flow)
async function sendMessage(cascadeId, text, options = {}) {
    const {
        modelId = 'MODEL_PLACEHOLDER_M26',
        timeoutMs = 120000,
        media = null,        // array of media objects (new multi-image approach)
        imageBase64 = null,  // legacy single-image (kept for backward compat)
    } = options;

    const items = [{ text }];

    const body = {
        metadata: {},
        cascadeId,
        items,
        cascadeConfig: {
            plannerConfig: {
                plannerTypeConfig: {
                    case: 'conversational',
                    value: {}
                },
                planModel: modelId,
                requestedModel: { modelId }
            }
        }
    };

    // Attach media[] at top level — matching the actual LS API spec
    if (media && media.length > 0) {
        body.media = media;
    } else if (imageBase64) {
        // Legacy fallback: wrap single image into media[] format
        body.media = [{
            mimeType: 'image/png',
            inlineData: imageBase64,
        }];
    }

    return callApiStream('SendUserCascadeMessage', body, timeoutMs, options.inst || null);
}

// Convenience: create a new conversation and send a message in one call
async function startAndSend(text, options = {}) {
    const inst = options.inst || null;
    const cascadeId = await startCascade(inst);
    console.log(`[Cascade] New conversation: ${cascadeId}`);
    const result = await sendMessage(cascadeId, text, { ...options, inst });
    return { cascadeId, result };
}

module.exports = { startCascade, sendMessage, startAndSend };
