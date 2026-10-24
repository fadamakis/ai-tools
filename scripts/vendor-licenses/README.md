# Dependency license text

These files supply full notices for bundled dependencies whose npm archives omit them. `sources.json` records each exact package version, declared license, source and SHA-256 of the retained text. The notice generator verifies the declaration and hash before using a fallback; a new dependency without legal text stops the build.

Three notices come from the exact published npm Git revision. `react-remove-scroll-bar` declares MIT in its published metadata and README, but its npm Git revision is unavailable upstream; its notice comes from the explicitly pinned upstream revision in the receipt. `format` declares MIT and supplies the copyright attribution in its packaged README; its unavailable external license page is replaced by the standard MIT grant. Those two provenance limitations are recorded explicitly rather than claiming an exact-release license retrieval.

When upgrading these dependencies, inspect the new package and upstream terms, retain the original attribution, and update the version-specific receipt. Do not reuse a fallback for a different package version.
