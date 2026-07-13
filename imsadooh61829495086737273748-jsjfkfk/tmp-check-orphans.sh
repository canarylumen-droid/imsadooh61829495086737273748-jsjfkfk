#!/bin/bash
cd /home/ubuntu/app
REDIS_HOST=$(grep REDIS_HOST .env | head -1 | cut -d= -f2-)
REDIS_PASS=$(grep REDIS_PASSWORD .env | head -1 | cut -d= -f2-)
echo "Orphans queue length:"
redis-cli -h "$REDIS_HOST" -a "$REDIS_PASS" LLEN imap:orphans 2>/dev/null
echo "Orphans content:"
redis-cli -h "$REDIS_HOST" -a "$REDIS_PASS" LRANGE imap:orphans 0 -1 2>/dev/null
echo "IMAP active connections count:"
redis-cli -h "$REDIS_HOST" -a "$REDIS_PASS" KEYS "imap:active:*" 2>/dev/null | wc -l
