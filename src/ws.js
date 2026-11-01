// === WebSocket Handling ===
// Manages WS connections, per-client conversation tracking, and broadcasting.

const { lsConfig } = require('./config');
const { getInstanceForCascade } = require('./poller');

const viewers = new Set();
const globalViewers = new Set(); // clients that want ALL events (Live Logs)
const clientConvMap = new Map(); // Map<ws, convId> — per-client conversation tracking
const clientVisibilityMap = new Map(); // Map<ws, boolean> — true if window is visible & active

let heartbeatInterval = null;

function setupWebSocket(wss, { ensureCached, stepCache }) {
    if (!heartbeatInterval) {
        heartbeatInterval = setInterval(() => {
            viewers.forEach(ws => {
                if (ws.isAlive === false) {
                    try { ws.terminate(); } catch { }
                    return;
                }
                ws.isAlive = false;
                try { ws.ping(); } catch { }
            });
        }, 20000);
    }

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        // Auth check for WebSocket (skip for localhost connections — same policy as HTTP)
        const authKey = process.env.AUTH_KEY || '';
        if (authKey) {
            const ip = req.socket.remoteAddress || '';
            const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
            if (!isLocal) {
                const url = new URL(req.url, 'http://localhost');
                const key = url.searchParams.get('auth_key');
                if (key !== authKey) {
                    ws.close(4401, 'Unauthorized');
                    return;
                }
            }
        }
        viewers.add(ws);
        // Hub model (2.0.11): detection = the shared hub LS is up (lsConfig.detected),
        // NOT whether any workspace is tracked (lsInstances is empty until a workspace
        // is opened/created, but the hub is still usable for new chats + history).
        ws.send(JSON.stringify({ type: 'status', detected: lsConfig.detected, port: lsConfig.port || null }));

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'set_conversation') {
                    clientConvMap.set(ws, msg.conversationId);
                    console.log(`[WS] set_conversation → ${msg.conversationId?.substring(0, 8)}, clients: ${clientConvMap.size}`);
                    await ensureCached(msg.conversationId, getInstanceForCascade(msg.conversationId));
                    const cache = stepCache[msg.conversationId];
                    sendToOne(ws, {
                        type: 'steps_init',
                        conversationId: msg.conversationId,
                        steps: cache ? cache.steps : [],
                        baseIndex: cache ? (cache.baseIndex || 0) : 0,
                        stepCount: cache ? (cache.stepCount || 0) : 0,
                    });
                } else if (msg.type === 'subscribe_all') {
                    // Live Logs mode: receive all broadcasts regardless of conversation
                    globalViewers.add(ws);
                    console.log(`[WS] subscribe_all — global viewers: ${globalViewers.size}`);
                } else if (msg.type === 'client_visibility') {
                    // Visibility update from frontend (document.visibilityState)
                    clientVisibilityMap.set(ws, !!msg.visible);
                } else if (msg.type === 'app_log') {
                    // Frontend error/log forwarding — rebroadcast to all Live Logs viewers
                    broadcastToGlobal({ ...msg, ts: msg.ts || Date.now() });
                }
            } catch (e) { }
        });

        ws.on('close', () => {
            viewers.delete(ws);
            globalViewers.delete(ws);
            clientConvMap.delete(ws);
            clientVisibilityMap.delete(ws);
        });
    });
}

function sendToOne(ws, data) {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(data, targetConvId) {
    const msg = JSON.stringify(data);
    const sent = new Set();
    // Send to viewers watching this specific conversation
    viewers.forEach(v => {
        if (v.readyState !== 1) return;
        if (targetConvId && clientConvMap.get(v) !== targetConvId) return;
        v.send(msg);
        sent.add(v);
    });
    // Also send to global viewers (Live Logs — all cascades)
    // Skip clients that already received via per-conversation match above
    globalViewers.forEach(v => {
        if (v.readyState !== 1) return;
        if (sent.has(v)) return;
        v.send(msg);
    });
}

// Broadcast to ALL connected viewers (no conversation filter)
function broadcastAll(data) {
    const msg = JSON.stringify(data);
    viewers.forEach(v => {
        if (v.readyState === 1) v.send(msg);
    });
}

// Broadcast to global viewers only (Live Logs subscribers — for app_log events)
function broadcastToGlobal(data) {
    const msg = JSON.stringify(data);
    globalViewers.forEach(v => {
        if (v.readyState === 1) v.send(msg);
    });
}

/**
 * Checks if any client currently has the specified conversation actively open and visible.
 * Used by push-service to avoid sending push notifications if the user is already actively
 * viewing the conversation on their screen.
 */
function isConversationActivelyViewed(convId) {
    for (const ws of viewers) {
        if (ws.readyState === 1 && clientVisibilityMap.get(ws) !== false) {
            if (!convId || clientConvMap.get(ws) === convId) {
                return true;
            }
        }
    }
    return false;
}

module.exports = { setupWebSocket, sendToOne, broadcast, broadcastAll, broadcastToGlobal, isConversationActivelyViewed };
