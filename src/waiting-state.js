// === Cascade Waiting State Manager ===
// Tracks cascades that require manual user action/input (gates, questions, command approvals).
// Broadcasts updates to all connected WebSocket clients and overrides status in API responses.

const waitingCascades = new Set();

function isCascadeWaiting(cascadeId) {
    if (!cascadeId) return false;
    return waitingCascades.has(cascadeId);
}

function setCascadeWaiting(cascadeId, isWaiting) {
    if (!cascadeId) return;
    const prev = waitingCascades.has(cascadeId);
    if (isWaiting) {
        waitingCascades.add(cascadeId);
    } else {
        waitingCascades.delete(cascadeId);
        try { require('./push-service').cancelDelayedPush(cascadeId); } catch {}
    }

    if (prev !== isWaiting) {
        console.log(`[WaitingState] ${cascadeId.substring(0, 8)} waiting status → ${isWaiting ? 'WAITING_FOR_USER' : 'ACTIVE/DONE'}`);
        try {
            const { broadcastAll } = require('./ws');
            broadcastAll({
                type: 'cascade_status',
                conversationId: cascadeId,
                status: isWaiting ? 'CASCADE_RUN_STATUS_WAITING_FOR_USER' : 'CASCADE_RUN_STATUS_RUNNING',
            });
            broadcastAll({ type: 'conversations_updated' });
        } catch {}
    }
}

function getAllWaitingCascades() {
    return Array.from(waitingCascades);
}

module.exports = {
    isCascadeWaiting,
    setCascadeWaiting,
    getAllWaitingCascades,
};
