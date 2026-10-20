# -*- coding: utf-8 -*-
"""提交前密钥守卫：扫描暂存区，命中真实密码则阻止提交。

背景：.gitattributes 的 clean 过滤器只覆盖已登记的文件；
新增文件（如新的脚本、新的文档）若写入明文密码不会被过滤，
因此这里对**整个暂存区**做一次兜底扫描。

密码来源：.server-config.json（已 gitignore）。
退出码 1 表示拦截提交。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, ".server-config.json")


def load_secrets():
    try:
        with open(CFG, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except Exception:
        return []
    out = []
    for section in ("neo4j", "ssh"):
        pwd = (cfg.get(section) or {}).get("password")
        if pwd:
            out.append(pwd)
    return out


def main():
    secrets = load_secrets()
    if not secrets:
        return 0

    staged = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    ).stdout.splitlines()

    hits = []
    for path in staged:
        blob = subprocess.run(
            ["git", "show", ":" + path],
            cwd=ROOT, capture_output=True, encoding="utf-8", errors="replace",
        ).stdout
        for secret in secrets:
            if secret in blob:
                hits.append(path)
                break

    if hits:
        sys.stderr.write(
            "\n[BLOCKED] 暂存区检测到明文密码，已阻止提交：\n"
            + "".join("  - " + h + "\n" for h in hits)
            + "\n处理方式：把该文件加入 .gitattributes 的 filter=secret 清单，\n"
              "或将密码改为读取环境变量。\n\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
