# -*- coding: utf-8 -*-
"""
图谱缓存刷新脚本
用途：Codex更新数据库后，清除Redis缓存并重启服务
使用：python refresh_cache.py
"""
import paramiko
import json
import time
import socket

# 读取本地配置
cfg_path = r"D:\Trae CN\AI专科知识图谱生成TraeCN\AI专科知识图谱生成TraeCN\kg-test-page\.server-config.json"
with open(cfg_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

ssh_cfg = cfg["ssh"]
redis_cli = cfg["redis"].get("cli_path", "/zoesoft/zoekgRedis/bin/redis-cli")
redis_host = cfg["redis"]["host"]
redis_port = cfg["redis"]["port"]

def refresh():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(ssh_cfg["host"], username=ssh_cfg["user"], password=ssh_cfg["password"], timeout=ssh_cfg["timeout"])
    print(f"Connected to {ssh_cfg['host']}")

    # 1. 清除Redis缓存
    stdin, stdout, stderr = ssh.exec_command(
        f"{redis_cli} -h 127.0.0.1 -p {redis_port} FLUSHALL",
        timeout=10
    )
    redis_result = stdout.read().decode().strip()
    print(f"Redis cache cleared: {redis_result}")

    # 2. 杀旧进程
    ssh.exec_command("pkill -f 'python.*server.py' 2>/dev/null")
    time.sleep(1)

    # 3. 重启服务
    transport = ssh.get_transport()
    channel = transport.open_channel("session")
    channel.settimeout(5)
    channel.exec_command("setsid bash -c 'cd /zoesoft/zoekgweb && python3 server.py >> server.log 2>&1 &'")
    try:
        out = channel.recv(4096).decode().strip()
        if out: print("Output:", out)
    except socket.timeout:
        print("Restart command sent")
    channel.close()

    time.sleep(4)

    # 4. 验证
    stdin, stdout, stderr = ssh.exec_command("ps aux | grep 'python.*server.py' | grep -v grep", timeout=5)
    proc = stdout.read().decode().strip()
    if proc:
        print(f"Server running: PID={proc.split()[1]}")
    else:
        print("WARNING: Server not running!")
        return False

    stdin, stdout, stderr = ssh.exec_command("curl -s http://127.0.0.1:4001/api/kg/stats | head -c 300", timeout=10)
    stats = stdout.read().decode().strip()
    if stats:
        print(f"API OK: {stats[:100]}...")
    else:
        print("WARNING: API not responding!")
        return False

    ssh.close()
    print("Refresh complete!")
    return True

if __name__ == "__main__":
    refresh()
