# Imported baseline (prior work, NOT hackathon development)

- Source repository: https://github.com/PeridotFinance/peridot-contracts-2-5 (public)
- Source commit: e08e53632fbc3a5f08f7f4d14f45b1ea90e4b2e3 (branch avalanche-pharaoh-tracks-abcd, on origin; linear descendant of main 603e26f3, 143 commits ahead)
- Source path: contracts/contracts/
- Method: `git archive <commit> contracts/contracts` (committed tree only; source repo's 21 uncommitted files excluded)
- Imported: top-level *.sol (Compound-V2-derived controller/pTokens, rate models, oracles, debt accounting), margin/, interfaces/, proxy/, Lens/, mock/, pancakev3/
- Excluded: DualInvestment/, Governance/, layerzero/, xperidot/, vendor/, boosted/, deployment/
- Licenses (SPDX headers): Compound-derived files BSD-3-Clause; Peridot additions MIT; one Apache-2.0 file. No top-level LICENSE file exists in the source repo; rights held by PeridotFinance (founder's organization) — founder to confirm.
- Imported on 2026-11-25. Everything after the tag `pre-xlayer-hackathon` is hackathon work.
