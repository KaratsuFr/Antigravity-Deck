#!/usr/bin/env python3
"""
Automated Language Server Discovery for agy on Proxmox.
Finds active agy process, listening port, and valid CSRF token from memory,
then updates /opt/antigravity-deck/hub.json.
"""
import os
import re
import sys
import time
import json
import urllib.request
import urllib.error

HUB_FILE = "/opt/antigravity-deck/hub.json"

def test_hub(port, token):
    url = f"http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus"
    req = urllib.request.Request(
        url,
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
            "x-codeium-csrf-token": token
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=0.3) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return bool(data.get("userStatus"))
    except Exception:
        pass
    return False

def discover():
    # 1. Quick test: does current hub.json still work?
    if os.path.exists(HUB_FILE):
        try:
            with open(HUB_FILE, "r") as f:
                cur = json.load(f)
            if cur.get("port") and cur.get("csrfToken"):
                if test_hub(cur["port"], cur["csrfToken"]):
                    return cur["port"], cur["csrfToken"]
        except Exception:
            pass

    # 2. Find agy PID
    pid_lines = os.popen('pgrep -f "/root/.local/bin/agy remote-control serve"').read().strip().split()
    if not pid_lines:
        pid_lines = os.popen('pgrep -x agy').read().strip().split()
    if not pid_lines:
        return None, None
    pid = int(pid_lines[0])

    # 3. Find listening ports of agy
    ss_cmd = f"ss -tlpn | grep 'pid={pid},' | awk '{{print $4}}'"
    ss_out = os.popen(ss_cmd).read().split()
    ports = []
    for p in ss_out:
        if ":" in p:
            try:
                ports.append(int(p.split(":")[-1]))
            except ValueError:
                pass
    ports = sorted(list(set(ports)))
    if not ports:
        return None, None

    # 4. Read memory maps for candidate UUIDs
    token_pattern = re.compile(rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    try:
        with open(f"/proc/{pid}/maps") as f:
            maps = f.readlines()
    except Exception:
        return None, None

    candidates = set()
    try:
        with open(f"/proc/{pid}/mem", "rb", 0) as mem:
            for line in maps:
                parts = line.split()
                if not parts[1].startswith("rw"):
                    continue
                start, end = [int(x, 16) for x in parts[0].split("-")]
                # Skip large maps to keep scan under ~2 seconds
                if end - start > 40 * 1024 * 1024:
                    continue
                try:
                    mem.seek(start)
                    chunk = mem.read(end - start)
                    for m in token_pattern.finditer(chunk):
                        candidates.add(m.group(0).decode("ascii"))
                except Exception:
                    pass
    except Exception:
        return None, None

    # 5. Test candidate tokens
    for port in ports:
        for token in candidates:
            if test_hub(port, token):
                # Save to hub.json
                out = {"port": port, "csrfToken": token, "updatedAt": int(time.time())}
                with open(HUB_FILE, "w") as f:
                    json.dump(out, f, indent=2)
                return port, token

    return None, None

if __name__ == "__main__":
    port, token = discover()
    if port and token:
        print(json.dumps({"port": port, "csrfToken": token}))
        sys.exit(0)
    else:
        print(json.dumps({"error": "hub not found"}))
        sys.exit(1)
