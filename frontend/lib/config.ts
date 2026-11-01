// === Frontend Configuration ===
// In monolithic architecture, Express serves static assets, REST API, and WebSockets.
// API: always relative path '' (same origin)
// WS:  always relative to current page host and protocol (ws:// or wss://)

export const API_BASE = '';

let _wsUrl: string | null = null;

export async function getWsUrl(): Promise<string> {
    if (_wsUrl) return _wsUrl;

    if (typeof window === 'undefined') {
        return 'ws://localhost:9808/ws';
    }

    // Clean up any stale legacy cache
    try {
        localStorage.removeItem('antigravity-ws-url');
    } catch {}

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    _wsUrl = `${proto}//${window.location.host}/ws`;
    return _wsUrl;
}

// Legacy sync export
export const WS_URL = '';

