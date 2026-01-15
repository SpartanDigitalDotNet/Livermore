// Atlas Configuration for Livermore Database
// State-based schema management - define desired state, Atlas diffs and applies

variable "database_url" {
  type    = string
  default = getenv("DATABASE_URL")
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
