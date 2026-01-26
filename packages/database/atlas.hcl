// Atlas Configuration for Livermore Database
// State-based schema management - define desired state, Atlas diffs and applies

variable "database_url" {
  type    = string
  default = getenv("DATABASE_URL")
}

variable "pg_sandbox_host" {
  type    = string
  default = getenv("PG_SANDBOX_HOST")
}

variable "pg_sandbox_user" {
  type    = string
  default = getenv("PG_SANDBOX_USER")
}

variable "pg_sandbox_password" {
  type    = string
  default = getenv("PG_SANDBOX_PASSWORD")
}

env "local" {
  // Source of truth - the desired schema state
  src = "file://schema.sql"

  // Target database
  url = var.database_url

  // Dev database for testing changes (uses Docker)
  dev = "docker://postgres/15/dev?search_path=public"

  // Schema to manage
  schemas = ["public"]

  // Diff policy - protect against accidental drops
  diff {
    skip {
      drop_schema = true
    }
  }
}

env "production" {
  src     = "file://schema.sql"
  url     = var.database_url
  schemas = ["public"]

  // Extra protection for production
  diff {
    skip {
      drop_schema = true
      drop_table  = true
    }
  }
}

env "sandbox" {
  // Source of truth - same schema as all environments
  src = "file://schema.sql"

  // Azure PostgreSQL connection - requires SSL
  url = "postgresql://${var.pg_sandbox_user}:${var.pg_sandbox_password}@${var.pg_sandbox_host}:5432/livermore?sslmode=require"

  // Schema to manage
  schemas = ["public"]

  // Diff policy - protect against accidental drops (same as local)
  diff {
    skip {
      drop_schema = true
    }
  }
}
