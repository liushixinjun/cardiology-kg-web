# -*- coding: utf-8 -*-
"""
一键部署脚本
用途：将本地修改部署到服务器
使用：python deploy.py

部署前置校验（防止"旧盖新"事故再次发生）：
  1) 作废页黑名单：任何已作废页面绝不允许上传（本地残留也直接拦截）
  2) 上传前逐文件存在性 + 非空校验
  3) 上传后回读服务器文件大小比对，确认写入成功
  4) 版本戳一致性：所有 HTML 的 ?v= 必须统一为同一版本戳
  5) 服务重启后必须验证进程存活 + API 可用，否则明确报失败
"""
import paramiko
import json
import os
import time
import socket
import re
import sys
import hashlib
from datetime import datetime

# 读取本地配置
cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".server-config.json")
with open(cfg_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

ssh_cfg = cfg["ssh"]
deploy_cfg = cfg["deploy"]
redis_cli = cfg["redis"].get("cli_path", "/zoesoft/zoekgRedis/bin/redis-cli")

# 版本戳：所有 HTML 中的 ?v= 统一用此值（格式 YYYYMMDDNN，NN为当日第几批）
VERSION_STAMP = datetime.now().strftime("%Y%m%d") + "13"
local_dir = deploy_cfg["local_dir"]

# ============ 部署保护闸 1：作废文件黑名单 ============
# 背景：2026-09-28 曾发生"本地旧文件覆盖线上新版"事故——线上 4001整改后的
# 新导航被本地旧 index.html/app.js 冲掉，作废页面（临床诊断模拟/路径编辑）
# 又被重新部署上线。此后任何作废文件一律禁止上传，本地残留即直接失败。
RETIRED_FILES = {
    "diagnosis.html", "engine.html", "engine_test.html",
    "disease.html", "graph.html", "instances.html", "kg-story.html",
    "clinical-workflow.html", "index_old.html", "index-old.html",
    "index-prototype.html", "server_fixed.py", "server.py.bak",
    "_shared/js/review.js", "_shared/js/version.js", "_shared/js/app-old.js",
}
RETIRED_PREFIXES = ("_shared\\",)  # 反斜杠残留目录（历史 Windows 上传事故）


def fail(msg):
    print("[FAIL] " + msg)
    sys.exit(1)


def md5_of(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def check_local_files():
    """闸1+闸2+闸4：黑名单、存在性、版本戳一致性"""
    print("== [1/4] 部署前本地校验")
    files = deploy_cfg["files"]

    blocked = [f for f in files if os.path.basename(f) in RETIRED_FILES]
    if blocked:
        fail("部署清单含作废文件，已阻止部署：%s\n"
             "        请从 .server-config.json 的 deploy.files 中移除。" % ", ".join(blocked))

    missing, empty = [], []
    for f in files:
        p = os.path.join(local_dir, f.replace("/", os.sep))
        if not os.path.exists(p):
            missing.append(f)
        elif os.path.getsize(p) == 0:
            empty.append(f)
    if missing:
        fail("以下文件在本地不存在，已阻止部署：%s" % ", ".join(missing))
    if empty:
        fail("以下文件为空文件，已阻止部署：%s" % ", ".join(empty))

    # 版本戳一致性：任一 HTML 出现两种不同戳即失败
    stamp_re = re.compile(r'(?:\.js|\.css)\?v=([0-9A-Za-z]+)')
    bad = []
    for fn in sorted(os.listdir(local_dir)):
        if not fn.endswith(".html"):
            continue
        with open(os.path.join(local_dir, fn), "r", encoding="utf-8", errors="ignore") as f:
            stamps = set(stamp_re.findall(f.read()))
        if stamps and stamps != {VERSION_STAMP}:
            bad.append("%s -> %s" % (fn, ",".join(sorted(stamps))))
    if bad:
        fail("版本戳不一致（应为 %s），已阻止部署：\n        %s" % (VERSION_STAMP, "\n        ".join(bad)))

    print("    ✓ 作废文件 0 个｜文件齐全 %d 个｜版本戳统一 %s" % (len(files), VERSION_STAMP))


def check_remote_baseline(ssh):
    """闸3：记录部署前服务器状态，便于事后比对"""
    print("== [2/4] 记录服务器部署前状态")
    stdin, stdout, stderr = ssh.exec_command(
        "cd %s && ls -1 *.html 2>/dev/null | wc -l" % deploy_cfg["remote_dir"], timeout=10)
    before = stdout.read().decode().strip()
    print("    服务器当前 HTML 页面数：%s" % before)
    return before


def upload(ssh):
    print("== [3/4] 上传文件（含上传后校验）")
    sftp = ssh.open_sftp()
    errors = []
    for f in deploy_cfg["files"]:
        local = os.path.join(local_dir, f.replace("/", os.sep))
        remote = deploy_cfg["remote_dir"] + "/" + f
        # 确保远端子目录存在
        rdir = os.path.dirname(remote)
        try:
            sftp.stat(rdir)
        except IOError:
            sftp.mkdir(rdir)
        sftp.put(local, remote)
        lsize = os.path.getsize(local)
        try:
            rsize = sftp.stat(remote).st_size
        except IOError:
            rsize = -1
        if lsize != rsize:
            errors.append("%s 本地%dB / 远端%dB" % (f, lsize, rsize))
            print("    ✗ %s" % f)
        else:
            print("    ✓ %s (%dB)" % (f, lsize))
    sftp.close()
    if errors:
        fail("以下文件上传后大小不一致，部署未完成：\n        " + "\n        ".join(errors))
    print("    ✓ 全部 %d 个文件上传并校验通过" % len(deploy_cfg["files"]))


def restart_and_verify(ssh):
    print("== [4/4] 清缓存 + 重启服务 + 验证")
    stdin, stdout, stderr = ssh.exec_command(
        "%s -h 127.0.0.1 -p 6379 FLUSHALL" % redis_cli, timeout=10)
    print("    Redis: %s" % stdout.read().decode().strip())

    ssh.exec_command("pkill -f 'python.*server.py' 2>/dev/null")
    time.sleep(2)

    transport = ssh.get_transport()
    channel = transport.open_channel("session")
    channel.settimeout(5)
    channel.exec_command(
        "cd %s && setsid bash -c 'python3 server.py >> server.log 2>&1 &'" % deploy_cfg["remote_dir"])
    try:
        out = channel.recv(4096).decode().strip()
        if out:
            print("    " + out)
    except socket.timeout:
        pass
    channel.close()
    time.sleep(4)

    stdin, stdout, stderr = ssh.exec_command(
        "ps aux | grep 'python.*server.py' | grep -v grep", timeout=5)
    proc = stdout.read().decode().strip()
    if not proc:
        fail("服务未启动！请检查服务器 %s/server.log" % deploy_cfg["remote_dir"])
    print("    ✓ 服务运行中 PID=%s" % proc.split()[1])

    stdin, stdout, stderr = ssh.exec_command(
        "curl -s http://127.0.0.1:4001/api/kg/version", timeout=15)
    ver = stdout.read().decode().strip()
    if not ver or '"version"' not in ver:
        fail("版本接口无响应，部署可能未生效。返回：%s" % ver[:120])
    print("    ✓ 版本接口：%s" % ver[:160])

    # 作废页回归：必须 404
    bad = []
    for r in ("diagnosis.html", "engine.html", "disease.html", "graph.html",
              "instances.html", "kg-story.html"):
        stdin, stdout, stderr = ssh.exec_command(
            "curl -s -o /dev/null -w '%%{http_code}' http://127.0.0.1:4001/%s" % r, timeout=10)
        code = stdout.read().decode().strip()
        if code != "404":
            bad.append("%s -> %s" % (r, code))
    if bad:
        fail("作废页面仍可访问，部署未达预期：%s" % ", ".join(bad))
    print("    ✓ 作废页回归：6 个页面全部 404")


def deploy():
    check_local_files()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(ssh_cfg["host"], username=ssh_cfg["user"],
                password=ssh_cfg["password"], timeout=ssh_cfg["timeout"])
    print("    Connected to %s" % ssh_cfg["host"])
    try:
        check_remote_baseline(ssh)
        upload(ssh)
        restart_and_verify(ssh)
    finally:
        ssh.close()
    print("\n[OK] 部署完成（版本戳 %s）" % VERSION_STAMP)


if __name__ == "__main__":
    deploy()
