# E2B template notes (verification pack)

Build a custom E2B template from `Dockerfile.verification` (or Build System 2.0 equivalent) so ports **7000–7005** are pre-started (7004 = SHACL / pySHACL, **7005 = React Flow ontology viewer**).

```bash
# Example (E2B CLI / SDK Build System 2.0)
# Set E2B_API_KEY, then build template alias `verification-fleet-v1`
```

Runtime selection:

```bash
export VERIFIER_SANDBOX_PROVIDER=e2b
export E2B_API_KEY=...
export VERIFIER_SANDBOX_TEMPLATE=verification-fleet-v1
export VERIFIER_LIVE=1
```

Daytona default:

```bash
export VERIFIER_SANDBOX_PROVIDER=daytona
export DAYTONA_API_KEY=...
export VERIFIER_LIVE=1
```

**Packing policy:** one sandbox per fleet run; all services co-located; retries reuse the same sandbox id.
