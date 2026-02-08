# Docker Setup

Docker Compose configuration for local development of the Livermore trading system.

## Services

### PostgreSQL 16
- **Port**: 5432
- **Database**: livermore
- **User**: livermore
- **Password**: livermore_dev_password (dev only!)
- **Volume**: `postgres_data` for data persistence

### Redis 7
- **Port**: 6379
- **Max Memory**: 256MB (LRU eviction)
- **Persistence**: RDB + AOF enabled
- **Volume**: `redis_data` for data persistence

## Usage

### Start Services

```bash
cd docker
docker-compose up -d
```

### Stop Services

```bash
docker-compose down
```

### Stop and Remove Volumes (WARNING: Deletes all data)

```bash
docker-compose down -v
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f postgres
docker-compose logs -f redis
```

### Check Service Health

```bash
docker-compose ps
```

## Connection Strings

Use these connection strings in your environment variables:

```bash
# PostgreSQL
DB_CONNECTION_STRING=postgresql://livermore:livermore_dev_password@localhost:5432
LIVERMORE_DATABASE_NAME=livermore

# Redis
LIVERMORE_REDIS_URL=redis://localhost:6379
```

## Accessing Services

### PostgreSQL CLI

```bash
docker exec -it livermore-postgres psql -U livermore -d livermore
```

### Redis CLI

```bash
docker exec -it livermore-redis redis-cli
```

## Production Note

**IMPORTANT**: This Docker setup is for **local development only**.

For production:
- Use managed database services (AWS RDS, Azure Database, etc.)
- Use strong passwords and secure connection strings
- Enable SSL/TLS connections
- Configure proper backup strategies
- Set up monitoring and alerts
