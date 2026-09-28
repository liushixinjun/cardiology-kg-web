#!/bin/bash
# 完整刷新：清Redis + 重启服务（捕获Codex夜间更新）
REDIS_CLI="/zoesoft/zoekgRedis/bin/redis-cli"
REDIS_PORT=6379

# 清除Redis缓存
$REDIS_CLI -h 127.0.0.1 -p $REDIS_PORT FLUSHALL
echo "$(date '+%Y-%m-%d %H:%M:%S') Redis FLUSHALL done" >> /zoesoft/zoekgweb/cron_refresh.log

# 重启服务
pkill -f 'python.*server.py' 2>/dev/null
sleep 2
cd /zoesoft/zoekgweb && setsid bash -c 'python3 server.py >> server.log 2>&1 &'
sleep 3

# 验证服务
if ps aux | grep 'python.*server.py' | grep -v grep > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Server restarted OK" >> /zoesoft/zoekgweb/cron_refresh.log
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') WARNING: Server restart failed!" >> /zoesoft/zoekgweb/cron_refresh.log
fi

