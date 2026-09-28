#!/bin/bash
# Redis缓存自动刷新（每2小时执行）
# 仅清除Redis缓存，不重启服务，不影响在线用户
/zoesoft/zoekgRedis/bin/redis-cli -h 127.0.0.1 -p 6379 FLUSHALL
echo "$(date '+%Y-%m-%d %H:%M:%S') Redis cache flushed" >> /zoesoft/zoekgweb/cron_refresh.log

