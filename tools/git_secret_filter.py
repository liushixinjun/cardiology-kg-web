# -*- coding: utf-8 -*-
"""git clean/smudge 过滤器：提交脱敏，检出还原。

用途：本地工作区文件保留真实密码（便于部署与查阅），
但进入 Git 仓库和推送到远端的内容只保留占位符。

密码来源：.server-config.json（已被 .gitignore 排除，不进仓库）

由 git 自动调用：
    git_secret_filter.py clean    工作区 -> 仓库（密码 -> 占位符）
    git_secret_filter.py smudge   仓库 -> 工作区（占位符 -> 密码）
"""
import json
import os
import sys

PLACEHOLDER_NEO4J = "__NEO4J_PWD__"
PLACEHOLDER_SSH = "__SSH_PWD__"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, ".server-config.json")


def load_secrets():
    """返回 [(真实密码, 占位符), ...]；配置文件缺失时返回空列表。"""
    try:
        with open(CFG, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except Exception:
        return []
    pairs = []
    neo = (cfg.get("neo4j") or {}).get("password")
    ssh = (cfg.get("ssh") or {}).get("password")
    if neo:
        pairs.append((neo, PLACEHOLDER_NEO4J))
    if ssh:
        pairs.append((ssh, PLACEHOLDER_SSH))
    return pairs


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "clean"
    data = sys.stdin.buffer.read()
    for secret, placeholder in load_secrets():
        raw = secret.encode("utf-8")
        ph = placeholder.encode("utf-8")
        data = data.replace(raw, ph) if mode == "clean" else data.replace(ph, raw)
    sys.stdout.buffer.write(data)


if __name__ == "__main__":
    main()
