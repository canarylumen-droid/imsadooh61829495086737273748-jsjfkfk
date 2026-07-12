#!/bin/bash
cd /home/ubuntu/app
DATABASE_URL=$(grep DATABASE_URL .env | head -1 | cut -d= -f2-)
psql "$DATABASE_URL" -f /tmp/migrate.sql
