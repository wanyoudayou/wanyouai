-- Read-only metadata. No secret/request values, no HTTP call.
-- net columns diagnose the retired pg_net transport; true does not block http.
select role_name,
  case when to_regnamespace('net') is not null
    then has_schema_privilege(role_name, 'net', 'USAGE') end as net_usage,
  case when to_regclass('net.http_request_queue') is not null
    then has_column_privilege(role_name, 'net.http_request_queue', 'headers', 'SELECT')
    end as net_headers_select,
  has_schema_privilege(role_name, 'vault', 'USAGE') as vault_usage,
  has_column_privilege(role_name, 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT')
    as vault_secret_select
from (values ('anon'), ('authenticated')) as roles(role_name);
