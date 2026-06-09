# Redis Setup Guide for AWS EC2

This guide shows how to install and configure Redis on your AWS EC2 instance instead of using external Redis services (ElastiCache, Upstash, etc.).

## Prerequisites
- AWS EC2 instance running Ubuntu 20.04/22.04 or Amazon Linux 2/2023
- SSH access to your EC2 instance
- sudo privileges

## Installation

### For Ubuntu/Debian:

```bash
# Update package list
sudo apt update

# Install Redis
sudo apt install redis-server -y

# Enable Redis to start on boot
sudo systemctl enable redis-server

# Start Redis service
sudo systemctl start redis-server

# Check Redis status
sudo systemctl status redis-server
```

### For Amazon Linux 2/2023:

```bash
# Enable EPEL repository (Amazon Linux 2)
sudo amazon-linux-extras install epel -y

# Or for Amazon Linux 2023
sudo dnf install epel-release -y

# Install Redis
sudo yum install redis -y
# OR for Amazon Linux 2023
sudo dnf install redis -y

# Enable Redis to start on boot
sudo systemctl enable redis

# Start Redis service
sudo systemctl start redis

# Check Redis status
sudo systemctl status redis
```

## Configuration

### 1. Bind to Localhost Only (Security)

**IMPORTANT: This step is required.** By default, Redis binds to all interfaces. For security, bind only to localhost:

```bash
# Edit Redis configuration
sudo nano /etc/redis/redis.conf
```

Find the line `bind 127.0.0.1 ::1` and change it to:
```
bind 127.0.0.1
```

### 2. Set a Password (Optional - Recommended for Production)

Skip this step for now. You can add a password later by editing `/etc/redis/redis.conf`:

```bash
# Uncomment and set a password
requirepass your-strong-password-here
```

Then update your `.env` to include the password:
```bash
REDIS_URL=redis://:your-strong-password@localhost:6379
```

### 3. Restart Redis

```bash
sudo systemctl restart redis-server
```

### 4. Test Connection

```bash
# Test with redis-cli
redis-cli

# If you set a password
AUTH your-strong-password-here

# Test ping
PING
# Should return: PONG

# Exit
exit
```

## Environment Configuration

Update your `.env` file on the EC2 instance:

**Without password (current setup):**
```bash
REDIS_URL=redis://localhost:6379
REDIS_TLS=false
```

**With password (if you add one later):**
```bash
REDIS_URL=redis://:your-strong-password-here@localhost:6379
REDIS_TLS=false
```

**Or use individual variables:**
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # Leave empty if no password
REDIS_TLS=false
```

## Performance Tuning (Optional)

For production workloads, edit `/etc/redis/redis.conf`:

```bash
# Maximum memory Redis can use (adjust based on your instance size)
maxmemory 2gb

# Eviction policy when memory is full
maxmemory-policy allkeys-lru

# Persistence settings
save 900 1
save 300 10
save 60 10000

# Disable AOF if not needed (faster performance)
appendonly no
```

Restart after changes:
```bash
sudo systemctl restart redis-server
```

## Security Best Practices

1. **Use a strong password** - Minimum 32 characters with mixed case, numbers, symbols
2. **Bind to localhost only** - Prevent external access
3. **Use firewall rules** - If external access is needed:
   ```bash
   # Allow only specific IP (e.g., your application server)
   sudo ufw allow from YOUR_APP_SERVER_IP to any port 6379
   ```
4. **Keep Redis updated** - Regular security updates
5. **Monitor Redis logs** - Check `/var/log/redis/redis-server.log`

## Persistence Setup

Redis data is stored in memory by default. To persist data:

### RDB (Snapshot) - Default
Already enabled in default config. Snapshots are saved to disk periodically.

### AOF (Append Only File) - More durable
```bash
# In /etc/redis/redis.conf
appendonly yes
appendfsync everysec
```

## Monitoring

```bash
# Check Redis info
redis-cli INFO

# Check memory usage
redis-cli INFO memory

# Check connected clients
redis-cli CLIENT LIST

# Monitor commands in real-time
redis-cli MONITOR
```

## Troubleshooting

### Redis won't start:
```bash
# Check logs
sudo journalctl -u redis-server -n 50

# Check configuration
sudo redis-server /etc/redis/redis.conf --test-memory
```

### Connection refused:
```bash
# Check if Redis is running
sudo systemctl status redis-server

# Check if port is listening
sudo netstat -tlnp | grep 6379
```

### Out of memory:
```bash
# Check Redis memory usage
redis-cli INFO memory | grep used_memory_human

# Adjust maxmemory in config
```

## Backup Strategy

```bash
# Manual backup of RDB file
sudo cp /var/lib/redis/dump.rdb /backup/redis-backup-$(date +%Y%m%d).rdb

# Automated backup script (add to cron)
0 2 * * * cp /var/lib/redis/dump.rdb /backup/redis-backup-$(date +\%Y\%m\%d).rdb
```

## Integration with Your Application

Your application already supports local Redis. Just set:
```bash
REDIS_URL=redis://:password@localhost:6379
```

The app will automatically connect to localhost Redis when this is set.
