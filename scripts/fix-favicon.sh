#!/bin/bash
set -e

# Add favicon location block before the first 'location /api/' in the HTTPS server block
sudo sed -i '/location \/api\//i\    location = /favicon.ico {\n        alias /home/ubuntu/app/dist/dist/public/favicon-32x32.png;\n        add_header Content-Type "image/png";\n        add_header Cache-Control "public, max-age=86400";\n    }\n' /etc/nginx/sites-available/audnixai

sudo nginx -t && sudo systemctl reload nginx
echo "nginx favicon fix applied"
