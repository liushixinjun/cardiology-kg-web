# -*- coding: utf-8 -*-
"""
一键部署脚本
用途：将本地修改部署到服务器
使用：python deploy.py
"""
import paramiko
import json
import os
import time
import socket
import re
from datetime import datetime

# 读取本地配置
cfg_path = r"e:\Trae CN\AI专科知识图谱生成TraeCN\kg-test-page\.server-config.json"
with open(cfg_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

ssh_cfg = cfg["ssh"]
deploy_cfg = cfg["deploy"]
redis_cli = cfg["redis"].get("cli_path", "/zoesoft/zoekgRedis/bin/redis-cli")

# 自动更新版本号：所有 HTML 中的 ?v=NNNNNN 统一用当前日期
VERSION = datetime.now().strftime("%Y%m%d")
local_dir = deploy_cfg["local_dir"]

def stamp_versions():
    """将所有 HTML 文件中的 asset 版本号统一为当前日期"""
    # 更新 version.js
    vjs_path = os.path.join(local_dir, "_shared", "js", "version.js")
    with open(vjs_path, "w", encoding="utf-8") as f:
        f.write(f"/* 全局资产版本号 — 由 deploy.py 自动更新 */\nwindow.ASSET_VERSION = '{VERSION}';\n")
    print(f"  version.js → {VERSION}")

    # 更新所有 HTML 中的 ?v= 参数
    for fn in os.listdir(local_dir):
        if not fn.endswith('.html'):
            continue
        fp = os.path.join(local_dir, fn)
        with open(fp, 'r', encoding='utf-8') as f:
            content = f.read()
        new_content = re.sub(r'(\.js|\.css)\?v=\d+', r'\g<1>?v=' + VERSION, content)
        if new_content != content:
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"  Stamp {fn} → v={VERSION}")

def deploy():
    stamp_versions()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(ssh_cfg["host"], username=ssh_cfg["user"], password=ssh_cfg["password"], timeout=ssh_cfg["timeout"])
    print(f"Connected to {ssh_cfg['host']}")

    # 1. 上传文件
    sftp = ssh.open_sftp()
    for f in deploy_cfg["files"]:
        local = os.path.join(deploy_cfg["local_dir"], f)
        remote = deploy_cfg["remote_dir"] + "/" + f
        print(f"  Upload {f}")
        sftp.put(local, remote)
    sftp.close()
    print("All files uploaded!")

    # 2. 清除Redis缓存
    stdin, stdout, stderr = ssh.exec_command(f"{redis_cli} -h 127.0.0.1 -p 6379 FLUSHALL", timeout=10)
    print(f"Redis cleared: {stdout.read().decode().strip()}")

    # 3. 重启服务
    ssh.exec_command("pkill -f 'python.*server.py' 2>/dev/null")
    time.sleep(1)

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

    stdin, stdout, stderr = ssh.exec_command("curl -s http://127.0.0.1:4001/api/kg/stats | head -c 200", timeout=10)
    stats = stdout.read().decode().strip()
    if stats:
        print(f"API OK: {stats[:80]}...")

    ssh.close()
    print("Deploy complete!")

if __name__ == "__main__":
    deploy()
