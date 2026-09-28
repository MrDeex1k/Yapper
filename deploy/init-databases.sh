#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set auth_password="$AUTH_DB_PASSWORD" --set app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE yapper_auth LOGIN PASSWORD :'auth_password';
CREATE ROLE yapper_app LOGIN PASSWORD :'app_password';
CREATE DATABASE yapper_auth OWNER yapper_auth;
CREATE DATABASE yapper_app OWNER yapper_app;
REVOKE ALL ON DATABASE yapper_auth FROM PUBLIC;
REVOKE ALL ON DATABASE yapper_app FROM PUBLIC;
GRANT CONNECT ON DATABASE yapper_auth TO yapper_auth;
GRANT CONNECT ON DATABASE yapper_app TO yapper_app;
SQL
