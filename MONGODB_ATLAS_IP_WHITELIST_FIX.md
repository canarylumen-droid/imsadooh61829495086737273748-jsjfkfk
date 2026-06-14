# MongoDB Atlas IP Whitelist Fix

## Issue
The `lead-recovery-worker` and `infra-scaler` services are failing to connect to MongoDB Atlas with the following error:

```
MongooseServerSelectionError: Could not connect to any servers in your MongoDB Atlas cluster. One common reason is that you're trying to access the database from an IP that isn't whitelisted. Make sure your current IP address is on your Atlas cluster's IP whitelist: https://www.mongodb.com/docs/atlas/security-whitelist/
```

## Root Cause
MongoDB Atlas requires IP whitelisting for security. The Railway/ECS deployment IPs are not whitelisted in the MongoDB Atlas cluster.

## Solution

### Option 1: Whitelist All IPs (Not Recommended for Production)
1. Go to MongoDB Atlas Console → Network Access
2. Click "Add IP Address"
3. Select "Allow Access from Anywhere" (0.0.0.0/0)
4. Click "Confirm"

**Warning**: This is not secure for production. Only use for testing.

### Option 2: Whitelist Specific IPs (Recommended)
1. Find your deployment's public IP:
   - For Railway: Check Railway dashboard → Service → Settings → Networking
   - For AWS ECS: Check the public IP of your NAT Gateway or EC2 instances
2. Go to MongoDB Atlas Console → Network Access
3. Click "Add IP Address"
4. Add the specific IP address or CIDR block
5. Click "Confirm"

### Option 3: Use VPC Peering (Best for Production)
1. Set up VPC peering between your cloud provider (AWS/Railway) and MongoDB Atlas
2. Configure private endpoints
3. Update connection string to use private endpoint

## Verification
After whitelisting, verify connection by checking logs:
- `lead-recovery-error.log` should show successful MongoDB connection
- `infra-scaler-error.log` should show successful MongoDB connection

## Services Affected
- `lead-recovery-worker` - Uses MongoDB for lead recovery data
- `infra-scaler` - Uses MongoDB for lead recovery backlog queries

## Notes
- The services are configured to retry every 5 minutes (300000ms) when MongoDB is unavailable
- This is a legacy MongoDB connection - the primary database is PostgreSQL (Neon)
- Consider migrating lead recovery data to PostgreSQL to eliminate this dependency
