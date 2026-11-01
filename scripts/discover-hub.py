#!/usr/bin/env python3
"""
Automated Language Server Discovery for agy on Proxmox.
Finds active agy process, listening port, and valid CSRF token from memory/environ,
then updates /opt/antigravity-deck/hub.json.
Runs in < 0.5s.
"""
import os
import re
import sys
import time
import json
import urllib.request
import subprocess

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
        with urllib.request.urlopen(req, timeout=0.5) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return bool(data.get("userStatus"))
    except Exception:
        pass
    return False

def get_agy_pid():
    out = subprocess.run(["pgrep", "-f", "/root/.local/bin/agy remote-control serve"], capture_output=True, text=True).stdout.strip().split()
    if not out:
        out = subprocess.run(["pgrep", "-x", "agy"], capture_output=True, text=True).stdout.strip().split()
    if out:
        return int(out[0])
    return None

def get_agy_ports(pid):
    out = subprocess.run(["ss", "-tlpn"], capture_output=True, text=True).stdout
    ports = []
    for line in out.splitlines():
        if f"pid={pid}," in line:
            parts = line.split()
            if len(parts) >= 4 and ":" in parts[3]:
                try:
                    ports.append(int(parts[3].split(":")[-1]))
                except ValueError:
                    pass
    return sorted(list(set(ports)))

def extract_tokens(pid):
    candidates = set()
    token_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

    # 1. Check proc environ of all running processes (fast, < 50ms)
    try:
        for p in os.listdir("/proc"):
            if not p.isdigit():
                continue
            try:
                with open(f"/proc/{p}/environ", "rb") as f:
                    env = f.read()
                idx = env.find(b"ANTIGRAVITY_CSRF_TOKEN=")
                if idx != -1:
                    raw = env[idx+23:idx+23+36].decode("ascii", errors="ignore")
                    if token_re.match(raw):
                        candidates.add(raw)
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
            except Exception:
                pass
    except Exception:
        pass

    # 2. Fast targeted substring scan in agy heap memory
    try:
        with open(f"/proc/{pid}/maps") as f:
            for line in f:
                parts = line.split()
                if not parts[1].startswith("rw"):
                    continue
                start, end = [int(x, 16) for x in parts[0].split("-")]
                if end - start > 500 * 1024 * 1024:
                    continue
                try:
                    with open(f"/proc/{pid}/mem", "rb", 0) as mem:
                        mem.seek(start)
                        chunk = mem.read(end - start)

                        # Match ANTIGRAVITY_CSRF_TOKEN=
                        pos = 0
                        while True:
                            idx = chunk.find(b"ANTIGRAVITY_CSRF_TOKEN=", pos)
                            if idx == -1:
                                break
                            raw = chunk[idx+23:idx+23+36].decode("ascii", errors="ignore")
                            if token_re.match(raw):
                                candidates.add(raw)
                            pos = idx + 36

                        # Match x-codeium-csrf-token
                        pos = 0
                        while True:
                            idx = chunk.find(b"x-codeium-csrf-token", pos)
                            if idx == -1:
                                break
                            window = chunk[idx:idx+80]
                            m = re.search(rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", window, re.IGNORECASE)
                            if m:
                                candidates.add(m.group(0).decode("ascii"))
                            pos = idx + 20
                except Exception:
                    pass
    except Exception:
        pass

    return candidates

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
    pid = get_agy_pid()
    if not pid:
        return None, None

    # 3. Find listening ports of agy
    ports = get_agy_ports(pid)
    if not ports:
        return None, None

    # 4. Extract candidates
    candidates = extract_tokens(pid)
    if not candidates:
        return None, None

    # 5. Test candidate tokens
    for port in ports:
        for token in candidates:
            if test_hub(port, token):
                out = {"port": port, "csrfToken": token, "updatedAt": int(time.time())}
                tmp_file = f"{HUB_FILE}.tmp"
                with open(tmp_file, "w") as f:
                    json.dump(out, f, indent=2)
                os.replace(tmp_file, HUB_FILE)
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
