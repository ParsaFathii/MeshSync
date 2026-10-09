## Summary
<!-- What does this PR change and why? One short paragraph. -->

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] CI / tooling / deploy / release
- [ ] Breaking change (verify against docs/API.md — the v1 contract is frozen)

## Testing done
<!-- Exact commands you ran and their outcome. Remove lines that do not apply. -->
```
go vet ./... && go test ./...        # run inside agent/
make -C native/cpp all && make -C native/cpp test
bun install --frozen-lockfile && bun run lint && bun run build
cd flutter && flutter pub get && flutter analyze && flutter test
scripts/validate-release.sh          # local pre-release gate
scripts/demo-sync.sh                 # end-to-end two-agent sync demo
```

## Screenshots (UI changes only)
<!-- Before/after for web console or Flutter changes. -->

## Checklist
- [ ] No secrets, tokens, or key material in the diff
- [ ] New third-party code is Apache-2.0 compatible and attributed (THIRD_PARTY_NOTICES.md)
- [ ] docs/API.md untouched unless the change is explicitly contract-versioned
